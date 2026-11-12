import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter } from '@rovdo/job-sources';
import { DiscoveryEngine, GlobalDiscoveryEngine } from './index';
const us = { version: 1 as const, countries: ['US'], origin: 'user' as const };
const body = {
  jobs: ['United States', 'Canada', 'Germany', 'Remote'].map((name, i) => ({
    id: i + 1,
    title: 'Museum Conservator',
    location: { name },
    absolute_url: `https://job-boards.greenhouse.io/scope/jobs/${i + 1}`,
    content: 'Conservation experience required.',
  })),
};
it('replays a fresh raw cache for expanded geography and keeps historical markers after contraction', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope(us);
  let requests = 0;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => {
      requests++;
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) };
    },
  });
  const feed = { ats: 'greenhouse', tenant: 'scope', region: 'global' };
  store.global.rememberCompany(
    feed,
    'Museum',
    'https://job-boards.greenhouse.io/scope',
    Date.now(),
  );
  const collect = async () => {
    const id = engine.start({
      sourceIds: ['greenhouse'],
      overrides: { greenhouse: { keywords: 'software' } },
      filters: { keywords: 'intern' },
    });
    for (let i = 0; i < 10 && store.global.run(id).status === 'running'; i++) await engine.tick();
    expect(store.global.run(id).status).toBe('completed');
    return id;
  };
  try {
    const first = await collect();
    expect(
      store
        .jobs()
        .map((j) => j.location)
        .sort(),
    ).toEqual(['Remote', 'United States']);
    const saved = store.jobs()[0]!;
    store.saveJob(saved.id, true);
    const before = requests;
    store.saveCollectionScope({ ...us, countries: ['US', 'CA'] });
    const expanded = await collect();
    expect(store.jobs().map((j) => j.location)).toContain('Canada');
    expect(store.jobs().map((j) => j.location)).not.toContain('Germany');
    expect(requests).toBe(before);
    expect(store.global.run(expanded).scopeIdentity).not.toBe(
      store.global.run(first).scopeIdentity,
    );
    store.saveCollectionScope(us);
    const contracted = await collect();
    expect(store.global.stats(contracted).jobs).toBe(2);
    expect(store.jobCount()).toBe(3);
    expect(store.savedIds()).toContain(saved.id);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
it('scopes saved-company ingestion, replays expansion before the next poll, and never closes excluded history', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ ...us, countries: ['US', 'CA'] });
  const config = {
    id: '00000000-0000-4000-8000-000000000001',
    ats: 'greenhouse' as const,
    tenant: 'scope',
    region: 'global' as const,
    company: 'Museum',
    enabled: true,
    intervalMs: 86400000,
    termsReviewedAt: '2026-11-11T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 2,
  };
  store.saveSource(config);
  let currentBody = body;
  let now = Date.now();
  const engine = new DiscoveryEngine(
    store,
    (source) =>
      new AtsAdapter(source, async () => ({
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify(currentBody)),
      })),
    { sleep: async () => {}, now: () => now, random: () => 0 },
  );
  try {
    await engine.poll(config.id);
    const canadian = store.jobs().find((j) => j.location === 'Canada')!;
    expect(canadian).toBeDefined();
    store.saveCollectionScope(us);
    await engine.poll(config.id);
    expect(store.job(canadian.id).activeStatus).toBe('open');
    expect(store.jobs().some((j) => j.location === 'Germany')).toBe(false);
    const american = store.jobs().find((j) => j.location === 'United States')!;
    currentBody = { jobs: body.jobs.filter((j) => j.location.name === 'Remote') };
    for (let i = 0; i < 2; i++) {
      now += 86400001;
      await engine.poll(config.id);
    }
    expect(store.job(canadian.id).activeStatus).toBe('open');
    expect(store.job(american.id).activeStatus).toBe('unknown');
    currentBody = body;
    store.saveCollectionScope({ ...us, countries: ['US', 'CA', 'DE'] });
    await engine.poll(config.id);
    expect(store.jobs().some((j) => j.location === 'Germany')).toBe(true);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
it('requires explicit geography before foreground collection', () => {
  const store = new CareerStore(':memory:');
  try {
    expect(() =>
      new GlobalDiscoveryEngine(store).start({ sourceIds: ['greenhouse'], overrides: {} }),
    ).toThrow('COLLECTION_COUNTRY_REQUIRED');
  } finally {
    store.close();
  }
});

it('replaces legacy resumed tasks with a scoped run while retaining historical checkpoints', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store);
  const id = randomUUID();
  store.global.saveRun({
    id,
    status: 'paused',
    lane: 'jobs',
    createdAt: 1,
    updatedAt: 1,
    profileVersion: null,
    queries: ['engineer'],
    options: { sourceIds: ['greenhouse'], overrides: {} },
    reason: 'Restarted',
  });
  try {
    await expect(engine.control(id, 'resume')).rejects.toThrow('COLLECTION_COUNTRY_REQUIRED');
    store.saveCollectionScope(us);
    await engine.control(id, 'resume');
    const replacement = engine.view().run;
    expect(replacement?.id).not.toBe(id);
    expect(replacement?.collectionScope?.revision).toBe(1);
    expect(store.global.run(id).status).toBe('paused');
    expect(store.global.run(id).scopeIdentity).toBe('historical-unscoped');
    expect(store.global.run(id).queries).toEqual(['engineer']);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
