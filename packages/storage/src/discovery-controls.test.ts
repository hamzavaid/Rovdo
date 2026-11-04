import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { GlobalDiscoveryEngine } from '@rovdo/job-discovery';
it('pages company inventory, persists opt-outs and does not mutate collected jobs', async () => {
  const store = new CareerStore(':memory:');
  try {
    for (let n = 0; n < 12; n++) {
      const feed = { ats: 'lever', tenant: `fixture${n}`, region: 'global' };
      store.global.rememberCompany(feed, `Company ${n}`, `https://jobs.lever.co/fixture${n}`, 1);
      store.global.validateCompany(feed, 2);
    }
    expect(store.global.companyPage({}).rows).toHaveLength(10);
    expect(store.global.companyPage({ offset: 10 }).rows).toHaveLength(2);
    store.global.configureBoard('lever:fixture0:global', 'retire');
    expect(store.global.companyPage({ status: 'disabled' }).total).toBe(1);
    expect(store.global.companyPage({}).verified).toBe(12);
    expect(store.jobCount()).toBe(0);
  } finally {
    store.close();
  }
});
it('records real stage events and redacted request history by lane', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => ({ status: 200, headers: {}, body: Buffer.from('{"jobs":[]}') }),
  });
  try {
    const id = engine.start({ sourceIds: ['remotive'], overrides: {} });
    await engine.tick();
    expect(store.global.events(id).map((e) => e.stage)).toContain('acquire');
    expect(store.global.requests('jobs').total).toBeGreaterThan(0);
    expect(store.global.requests('companies').total).toBe(0);
    store.global.request({
      runId: id,
      sourceId: 'fixture',
      at: 1,
      target: 'https://example.com/jobs?secret=private',
      status: 200,
      durationMs: 1,
      bytes: 5,
      error: null,
      cached: false,
    });
    expect(store.global.requests('jobs').rows[0]!.target).toBe('https://example.com/jobs');
  } finally {
    await engine.shutdown();
    store.close();
  }
});
