import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { GlobalDiscoveryEngine } from '@rovdo/job-discovery';
it('pages company inventory, persists opt-outs and does not mutate collected jobs', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US'], origin: 'user' });
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
    store.global.configureBoard('lever:fixture1:global', 'interval', 86400000);
    expect(store.global.board('lever:fixture1:global')?.intervalMs).toBe(86400000);
    expect(store.jobCount()).toBe(0);
    store.global.reserveCompanyRequest('wayback', Date.now());
    store.global.recordFinderBoard('wayback', 'lever:fixture1:global');
    store.global.recordFinderBoard('wayback', 'lever:fixture1:global');
    expect(store.global.finderYield('wayback')).toEqual({ requests: 1, verified: 1, yield: 1 });
  } finally {
    store.close();
  }
});
it('records real stage events and redacted request history by lane', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US'], origin: 'user' });
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
