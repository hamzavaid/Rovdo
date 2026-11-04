import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { DISCOVERY_SOURCES, GLOBAL_DEFAULT_SOURCES } from '@rovdo/job-sources';
import { migrateDiscoveryOptions } from '@rovdo/shared';
import { GlobalDiscoveryEngine } from './global-engine';

it('keeps exactly eleven job adapters and excludes archive finders from foreground work', async () => {
  expect(DISCOVERY_SOURCES).toHaveLength(11);
  expect(GLOBAL_DEFAULT_SOURCES).not.toContain('wayback');
  expect(GLOBAL_DEFAULT_SOURCES).not.toContain('common-crawl');
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    transport: async () => {
      throw new Error('Unexpected network');
    },
  });
  try {
    expect(() => engine.start({ sourceIds: ['wayback'], overrides: {} })).toThrow('UNKNOWN_SOURCE');
    const id = engine.start({ sourceIds: ['lever'], overrides: {} });
    expect(
      store.global
        .ready(id, Date.now(), 100)
        .some((t) => ['wayback', 'common-crawl'].includes(t.sourceId)),
    ).toBe(false);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
it('migrates archive-only and mixed selections without reviving explicitly empty selections', () => {
  expect(
    migrateDiscoveryOptions({ sourceIds: ['lever', 'wayback'], overrides: {} }).sourceIds,
  ).toEqual(['lever']);
  expect(
    migrateDiscoveryOptions({ sourceIds: ['wayback', 'common-crawl'], overrides: {} }).sourceIds,
  ).toHaveLength(11);
  expect(migrateDiscoveryOptions({ sourceIds: [], overrides: {} }).sourceIds).toEqual([]);
});
