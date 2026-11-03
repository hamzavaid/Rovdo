import { it, expect, vi } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import { DISCOVERY_SOURCES } from '@rovdo/job-sources';
import { randomUUID } from 'node:crypto';
it('reuses an enabled successfully polled employer without waiting for archive discovery', () => {
  const store = new CareerStore(':memory:');
  try {
    store.saveSource({
      id: randomUUID(),
      ats: 'lever',
      tenant: 'known',
      company: 'Known Employer',
      enabled: true,
      region: 'eu',
      intervalMs: 60000,
      termsReviewedAt: new Date().toISOString(),
      timezone: 'UTC',
      priority: 0,
      missingGracePolls: 3,
      pageUrl: 'https://jobs.eu.lever.co/known',
    });
    const saved = store.sources()[0]!;
    store.setState(saved.config.id, { ...saved.state, lastSuccessAt: 100, status: 'OK' });
    const engine = new GlobalDiscoveryEngine(store);
    const unboundedRead = vi.spyOn(store, 'sources').mockImplementation(() => {
      throw new Error('Global search must not scan every stored source');
    });
    const id = engine.start({ sourceIds: ['lever', 'wayback'], overrides: {} });
    unboundedRead.mockRestore();
    expect(store.global.ready(id, Date.now(), 1)[0]).toMatchObject({
      kind: 'ats',
      payload: { company: 'Known Employer', feed: { region: 'eu' } },
    });
    expect(store.sources()).toHaveLength(1);
  } finally {
    store.close();
  }
});
it('keeps a region-aware persistent inventory independent of saved company grants', () => {
  const store = new CareerStore(':memory:');
  try {
    const feed = { ats: 'lever', tenant: 'example', region: 'eu' };
    store.global.rememberCompany(feed, 'Example', 'https://jobs.eu.lever.co/example', 100);
    store.global.rememberCompany(feed, 'Example', 'https://jobs.eu.lever.co/example', 200);
    expect(store.global.companyBatch('', 10)).toHaveLength(1);
    expect(store.global.companyBatch('', 10)[0]).toMatchObject({ validatedAt: null, region: 'eu' });
    store.global.validateCompany(feed, 300);
    expect(store.global.companyBatch('', 10, true)[0]!.validatedAt).toBe(300);
    const engine = new GlobalDiscoveryEngine(store);
    const run = engine.start({ sourceIds: ['lever', 'wayback'], overrides: {} });
    expect(store.global.ready(run, Date.now(), 3)[0]!.kind).toBe('ats');
    expect(store.directory()).toHaveLength(0);
    expect(DISCOVERY_SOURCES.some((s) => s.id === 'wayback')).toBe(true);
    expect(
      DISCOVERY_SOURCES.every(
        (s) => !['scraper', 'unsupported', 'configuration'].includes(s.status),
      ),
    ).toBe(true);
  } finally {
    store.close();
  }
});
it('continues successful employer backfill across bounded batches and excludes disabled feeds', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => ({ status: 200, headers: {}, body: Buffer.from('[]') }),
  });
  try {
    for (let i = 1; i <= 52; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      store.saveSource({
        id,
        ats: 'lever',
        tenant: `employer${i}`,
        company: `Employer ${i}`,
        enabled: i !== 52,
        region: 'global',
        intervalMs: 60000,
        termsReviewedAt: new Date().toISOString(),
        timezone: 'UTC',
        priority: 0,
        missingGracePolls: 3,
      });
      const saved = store.sources().find((s) => s.config.id === id)!;
      store.setState(id, { ...saved.state, lastSuccessAt: 100 });
    }
    const first = store.discoverySourceBatch();
    expect(first).toHaveLength(50);
    expect(store.discoverySourceBatch(first.at(-1)!.config.id)).toHaveLength(1);
    engine.start({ sourceIds: ['lever'], overrides: {} });
    for (let i = 0; i < 30 && store.global.companyBatch('', 100).length < 51; i++)
      await engine.tick();
    expect(store.global.companyBatch('', 100)).toHaveLength(51);
    expect(store.global.companyBatch('', 100).some((s) => s.tenant === 'employer52')).toBe(false);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
