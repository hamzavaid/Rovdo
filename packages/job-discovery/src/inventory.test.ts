import { it, expect } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import { DISCOVERY_SOURCES } from '@rovdo/job-sources';
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
