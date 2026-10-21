import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { randomUUID } from 'node:crypto';
it('persists resumable queues and makes task and discovery membership insertion idempotent', () => {
  const store = new CareerStore(':memory:');
  try {
    const id = randomUUID();
    const run = {
      id,
      status: 'running' as const,
      createdAt: 1,
      updatedAt: 1,
      profileVersion: null,
      queries: ['TypeScript jobs'],
      options: { sourceIds: ['himalayas'], overrides: {} },
      reason: null,
    };
    store.global.saveRun(run);
    const task = {
      id: 'task',
      runId: id,
      sourceId: 'himalayas',
      kind: 'provider' as const,
      payload: { page: 1 },
      status: 'pending' as const,
      nextAt: 0,
      attempts: 0,
      error: null,
      priority: 0,
    };
    store.global.enqueue(task);
    store.global.enqueue(task);
    expect(store.global.ready(id, 1)).toHaveLength(1);
    store.global.saveTask({ ...task, status: 'running' });
    store.global.recover();
    expect(store.global.run(id).status).toBe('paused');
    expect(store.global.ready(id, 1)).toHaveLength(1);
    expect(store.global.stats(id).pending).toBe(1);
  } finally {
    store.close();
  }
});

it('keeps ranking warm-up incremental rather than retaining a whole-search array', async () => {
  const { sampleCandidate, sampleJob } = await import('../../../tests/fixtures/ranking-v2');
  const { BUILTIN_RANKINGS } = await import('@rovdo/career');
  const store = new CareerStore(':memory:');
  try {
    const runId = randomUUID();
    store.global.saveRun({
      id: runId,
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
      profileVersion: null,
      queries: [],
      options: { sourceIds: ['himalayas'], overrides: {} },
      reason: null,
    });
    const source = store.globalSource('fixture', 'Fixture', 'https://careers.example/jobs');
    store.ingestDiscovered(
      runId,
      source,
      Array.from({ length: 5 }, (_, i) => ({
        ...sampleJob(),
        id: 'job' + i,
        canonicalUrl: 'https://careers.example/jobs/' + i,
        requisitionId: null,
        provenance: [
          {
            sourceId: source.id,
            sourceKey: 'job' + i,
            url: 'https://careers.example/jobs/' + i,
            collectedAt: 1,
            rawSha256: 'a'.repeat(64),
            fields: {},
          },
        ],
      })),
    );
    const search = {
      query: '',
      company: '',
      workMode: 'all' as const,
      savedOnly: false,
      includeExcluded: false,
    };
    const profile = sampleCandidate();
    const first = store.rankedPage(
      store.iterateFiltered(search),
      profile,
      BUILTIN_RANKINGS[1]!,
      '2026-10-21',
      search,
      2,
    );
    expect(first.pending).toBe(3);
    store.rankedPage(
      store.iterateFiltered(search),
      profile,
      BUILTIN_RANKINGS[1]!,
      '2026-10-21',
      search,
      2,
    );
    expect(
      store.rankedPage(
        store.iterateFiltered(search),
        profile,
        BUILTIN_RANKINGS[1]!,
        '2026-10-21',
        search,
        2,
      ).pending,
    ).toBe(0);
  } finally {
    store.close();
  }
});
