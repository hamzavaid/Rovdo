import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import { CompanyDiscoveryScheduler } from './company-scheduler';
import { randomUUID } from 'node:crypto';

it('verifies a valid empty tenant even when its public page cannot establish an employer name', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
  store.global.rememberCompany(
    { ats: 'lever', tenant: 'unnamed', region: 'global' },
    '',
    'https://jobs.lever.co/unnamed',
    Date.now(),
  );
  const scheduler = new CompanyDiscoveryScheduler(store, {
    sleep: async () => {},
    transport: async (url) => ({
      status: 200,
      headers: {},
      body: Buffer.from(
        url.includes('robots.txt')
          ? 'User-agent: *\nAllow: /'
          : url.includes('api.lever.co')
            ? '[]'
            : '<html><title>Careers</title></html>',
      ),
    }),
  });
  try {
    scheduler.engine.start({ sourceIds: ['lever'], overrides: {} });
    for (let n = 0; n < 5; n++) await scheduler.engine.tick();
    expect(store.global.board('lever:unnamed:global')?.validatedAt).not.toBeNull();
    expect(store.directory()[0]).toMatchObject({ company: '', nameStatus: 'pending' });
    expect(store.jobCount()).toBe(0);
  } finally {
    await scheduler.shutdown();
    store.close();
  }
});

it('moves legacy archive cursors without losing checkpoint identity and resumes without root replay', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
  const old = randomUUID();
  store.global.saveRun({
    id: old,
    status: 'paused',
    createdAt: 1,
    updatedAt: 1,
    profileVersion: null,
    queries: [],
    options: { sourceIds: ['lever', 'wayback'], overrides: {} },
    reason: 'pause',
  });
  store.global.enqueue({
    id: 'persisted-page',
    runId: old,
    sourceId: 'wayback',
    kind: 'provider',
    payload: { target: 2, partition: 4, resumeKey: 'saved-cursor' },
    status: 'pending',
    nextAt: 0,
    attempts: 0,
    error: null,
    priority: 0,
  });
  const scheduler = new CompanyDiscoveryScheduler(store);
  try {
    const moved = store.global.runs().find((r) => r.lane === 'companies')!;
    expect(store.global.stats(old).pending).toBe(0);
    expect(store.global.ready(moved.id, Date.now(), 100)).toMatchObject([
      { id: 'persisted-page', payload: { resumeKey: 'saved-cursor' } },
    ]);
    await scheduler.control(moved.id, 'resume');
    expect(store.global.ready(moved.id, Date.now(), 100)).toHaveLength(1);
    expect(store.global.ready(moved.id, Date.now(), 100)[0]!.payload.resumeKey).toBe(
      'saved-cursor',
    );
  } finally {
    await scheduler.shutdown();
    store.close();
  }
});

it('runs company discovery without a search click, but yields all new archive requests to interactive work', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
  const calls: string[] = [];
  const jobs = new GlobalDiscoveryEngine(store);
  const companies = new CompanyDiscoveryScheduler(store, {
    sleep: async () => {},
    transport: async (url) => {
      calls.push(url);
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          url.endsWith('collinfo.json')
            ? '[{"cdx-api":"https://index.commoncrawl.org/CC-MAIN-2026-43-index"}]'
            : url.includes('showNumPages')
              ? '{"pages":0}'
              : '[["original"]]',
        ),
      };
    },
  });
  try {
    const id = jobs.start({ sourceIds: ['lever'], overrides: {} });
    await companies.tick();
    expect(calls).toEqual([]);
    for (let n = 0; n < 5 && store.global.run(id).status === 'running'; n++) await jobs.tick();
    await companies.tick();
    expect(
      calls.some((url) => url.includes('archive.org') || url.includes('commoncrawl.org')),
    ).toBe(true);
    const before = store.global.runs().filter((r) => r.lane === 'companies').length;
    await companies.tick();
    expect(store.global.runs().filter((r) => r.lane === 'companies')).toHaveLength(before);
  } finally {
    await jobs.shutdown();
    await companies.shutdown();
    store.close();
  }
});
it('honors the persistent automatic-discovery opt-out', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
  store.setting('automatic-company-discovery', 'false');
  const companies = new CompanyDiscoveryScheduler(store, {
    transport: async () => {
      throw new Error('Network must stay off');
    },
  });
  try {
    await companies.tick();
    expect(store.global.runs()).toHaveLength(0);
  } finally {
    await companies.shutdown();
    store.close();
  }
});
