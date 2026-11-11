/** Upcoming discovery scheduling contracts. NOT RUN; fixtures never contact public services. */
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter } from '@rovdo/job-sources';
import type { PublicResponse, ReadOptions } from '@rovdo/shared/network';
import { GlobalDiscoveryEngine } from './global-engine';
import { CompanyDiscoveryScheduler } from './company-scheduler';
import { DiscoveryEngine } from './index';

const response = (body: unknown): PublicResponse => ({
  status: 200,
  headers: {},
  body: Buffer.from(JSON.stringify(body)),
});

// Drain bounded event-loop turns, never elapsed time. Abort-aware fixtures settle on cleanup
// even when the expected request has not started, so a RED assertion cannot hang shutdown.
async function drainUntil(predicate: () => boolean) {
  for (let turn = 0; turn < 80 && !predicate(); turn++) await yieldTurn();
}

function heldTransport() {
  const starts: string[] = [];
  const pending = new Map<string, (value: PublicResponse) => void>();
  let active = 0;
  let maximum = 0;
  let aborted = 0;
  const transport = (url: string, options?: ReadOptions): Promise<PublicResponse> => {
    starts.push(url);
    active++;
    maximum = Math.max(maximum, active);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value?: PublicResponse) => {
        if (settled) return;
        settled = true;
        active--;
        pending.delete(url);
        options?.signal?.removeEventListener('abort', abort);
        if (value) resolve(value);
        else reject(new Error('Fixture request aborted'));
      };
      const abort = () => {
        aborted++;
        finish();
      };
      pending.set(url, finish);
      options?.signal?.addEventListener('abort', abort, { once: true });
      if (options?.signal?.aborted) abort();
    });
  };
  return {
    transport,
    starts,
    pending,
    get maximum() {
      return maximum;
    },
    get aborted() {
      return aborted;
    },
  };
}

function emptyQueue(store: CareerStore, runId: string) {
  for (const task of store.global.ready(runId, Date.now(), 100))
    store.global.saveTask({ ...task, status: 'done' });
}

function boardTask(
  store: CareerStore,
  runId: string,
  ats: 'lever' | 'ashby' | 'greenhouse',
  tenant: string,
  priority: number,
) {
  store.global.enqueue({
    id: tenant,
    runId,
    sourceId: 'company-inventory',
    kind: 'ats',
    payload: {
      feed: { ats, tenant, region: 'global' },
      company: `Synthetic ${tenant}`,
      pageUrl: `https://careers.synthetic.example/${tenant}`,
    },
    status: 'pending',
    nextAt: 0,
    attempts: 0,
    error: null,
    priority,
  });
}

it('refills a freed slot and publishes healthy jobs before a slow unrelated board completes', async () => {
  const store = new CareerStore(':memory:');
  const fixture = heldTransport();
  const engine = new GlobalDiscoveryEngine(store, {
    transport: fixture.transport,
    sleep: async () => {},
  });
  try {
    const id = engine.start({
      sourceIds: ['lever', 'ashby', 'greenhouse', 'remotive'],
      overrides: {},
    });
    emptyQueue(store, id);
    boardTask(store, id, 'lever', 'slow', 40);
    boardTask(store, id, 'ashby', 'fast', 30);
    boardTask(store, id, 'greenhouse', 'other', 20);
    store.global.enqueue({
      id: 'healthy-feed',
      runId: id,
      sourceId: 'remotive',
      kind: 'provider',
      payload: {},
      status: 'pending',
      nextAt: 0,
      attempts: 0,
      error: null,
      priority: 10,
    });
    const running = engine.tick();
    await drainUntil(() => fixture.starts.length >= 3);
    expect(fixture.starts).toHaveLength(3);
    const slow = fixture.starts.find((url) => url.includes('api.lever.co'))!;
    const fast = fixture.starts.find((url) => url.includes('ashbyhq.com'))!;
    expect(fixture.pending.has(slow)).toBe(true);
    fixture.pending.get(fast)!(response({ jobs: [] }));
    await drainUntil(() => fixture.starts.some((url) => url.includes('remotive.com')));
    const healthy = fixture.starts.find((url) => url.includes('remotive.com'));
    expect(healthy).toBeDefined();
    fixture.pending.get(healthy!)!(
      response({
        jobs: [
          {
            id: 1,
            title: 'Synthetic Niche Technician',
            company_name: 'Synthetic Healthy Employer',
            url: 'https://careers.synthetic.example/healthy/1',
            description: 'Specialized equipment maintenance.',
            candidate_required_location: 'United States',
          },
        ],
      }),
    );
    await drainUntil(() => store.jobCount() === 1);
    expect(store.jobs().map((job) => job.title)).toEqual(['Synthetic Niche Technician']);
    expect(fixture.pending.has(slow)).toBe(true);
    expect(fixture.maximum).toBeLessThanOrEqual(3);
    await engine.control(id, 'pause');
    await running;
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('serializes two boards on one origin while another origin continues', async () => {
  const store = new CareerStore(':memory:');
  const fixture = heldTransport();
  const engine = new GlobalDiscoveryEngine(store, {
    transport: fixture.transport,
    sleep: async () => {},
  });
  try {
    const id = engine.start({ sourceIds: ['lever', 'ashby'], overrides: {} });
    emptyQueue(store, id);
    boardTask(store, id, 'lever', 'first', 30);
    boardTask(store, id, 'lever', 'second', 20);
    boardTask(store, id, 'ashby', 'independent', 10);
    const running = engine.tick();
    await drainUntil(() => fixture.starts.length >= 2);
    expect(fixture.starts.filter((url) => url.includes('api.lever.co'))).toHaveLength(1);
    expect(fixture.starts.some((url) => url.includes('ashbyhq.com'))).toBe(true);
    const first = fixture.starts.find((url) => url.includes('/first?'))!;
    fixture.pending.get(first)!(response([]));
    await drainUntil(() => fixture.starts.some((url) => url.includes('/second?')));
    expect(fixture.starts.filter((url) => url.includes('api.lever.co'))).toHaveLength(2);
    expect(fixture.maximum).toBeLessThanOrEqual(3);
    await engine.control(id, 'pause');
    await running;
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('shares same-origin serialization and reservations with the saved-company poller', async () => {
  let now = Date.parse('2026-11-11T12:00:00Z');
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const store = new CareerStore(':memory:');
  const fixture = heldTransport();
  const sleepers: (() => void)[] = [];
  const sleep = (_ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Fixture wait aborted'));
      sleepers.push(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  const saved = new DiscoveryEngine(store, (source) => new AtsAdapter(source, fixture.transport), {
    now: () => now,
    sleep,
  });
  const global = new GlobalDiscoveryEngine(store, { transport: fixture.transport, sleep });
  try {
    const sourceId = '00000000-0000-4000-8000-000000000991';
    store.saveSource({
      id: sourceId,
      ats: 'lever',
      tenant: 'saved-first',
      company: 'Synthetic Saved Employer',
      enabled: true,
      region: 'global',
      intervalMs: 60000,
      termsReviewedAt: '2026-11-11T00:00:00Z',
      timezone: 'UTC',
      priority: 0,
      missingGracePolls: 2,
    });
    const polling = saved.poll(sourceId);
    await drainUntil(() => fixture.starts.length === 1);
    expect(fixture.starts).toHaveLength(1);
    const first = fixture.starts[0]!;
    expect(store.originReady('https://api.lever.co')).toBe(now + 1000);
    const id = global.start({ sourceIds: ['lever'], overrides: {} });
    emptyQueue(store, id);
    boardTask(store, id, 'lever', 'global-second', 10);
    const collecting = global.tick();
    await drainUntil(() => sleepers.length > 0);
    // Advancing the quota clock alone cannot authorize overlapping origin requests.
    now += 1000;
    sleepers.splice(0).forEach((release) => release());
    await drainUntil(() => fixture.starts.length > 1);
    expect(fixture.starts).toHaveLength(1);
    fixture.pending.get(first)!(response([]));
    await polling;
    sleepers.splice(0).forEach((release) => release());
    await drainUntil(() => fixture.starts.length === 2);
    expect(fixture.starts[1]).toContain('/global-second?');
    expect(store.originReady('https://api.lever.co')).toBeGreaterThanOrEqual(now + 1000);
    expect(fixture.maximum).toBe(1);
    await global.control(id, 'pause');
    await collecting;
  } finally {
    await global.shutdown();
    await saved.shutdown();
    clock.mockRestore();
    store.close();
  }
});

it.each(['pause', 'shutdown'] as const)(
  'aborts active IO and preserves the cursor on %s',
  async (action) => {
    const store = new CareerStore(':memory:');
    const fixture = heldTransport();
    const engine = new GlobalDiscoveryEngine(store, {
      transport: fixture.transport,
      sleep: async () => {},
    });
    try {
      const id = engine.start({ sourceIds: ['himalayas'], overrides: {} });
      emptyQueue(store, id);
      const payload = { query: 'synthetic', page: 7 };
      store.global.enqueue({
        id: 'checkpoint-page',
        runId: id,
        sourceId: 'himalayas',
        kind: 'provider',
        payload,
        status: 'pending',
        nextAt: 0,
        attempts: 0,
        error: null,
        priority: 1,
      });
      const running = engine.tick();
      await drainUntil(() => fixture.starts.length === 1);
      expect(fixture.starts).toHaveLength(1);
      const stopping = action === 'pause' ? engine.control(id, 'pause') : engine.shutdown();
      await drainUntil(() => fixture.aborted === 1);
      expect(fixture.aborted).toBe(1);
      await stopping;
      await running;
      expect(store.global.run(id).status).toBe('paused');
      expect(store.global.ready(id, Number.MAX_SAFE_INTEGER, 100)).toMatchObject([
        { id: 'checkpoint-page', payload },
      ]);
      expect(store.jobCount()).toBe(0);
    } finally {
      await engine.shutdown();
      store.close();
    }
  },
);

it('advances bounded automatic company work while a foreground run is still active', async () => {
  const store = new CareerStore(':memory:');
  const jobs = new GlobalDiscoveryEngine(store);
  const fixture = heldTransport();
  const companies = new CompanyDiscoveryScheduler(store, {
    transport: fixture.transport,
    sleep: async () => {},
  });
  try {
    const foreground = jobs.start({ sourceIds: ['remotive'], overrides: {} });
    const running = companies.tick();
    await drainUntil(() => fixture.starts.length > 0);
    expect(store.global.run(foreground).status).toBe('running');
    expect(fixture.starts.some((url) => /archive\.org|commoncrawl\.org/.test(url))).toBe(true);
    expect(fixture.maximum).toBeLessThanOrEqual(3);
    await companies.shutdown();
    await running;
  } finally {
    await companies.shutdown();
    await jobs.shutdown();
    store.close();
  }
});
