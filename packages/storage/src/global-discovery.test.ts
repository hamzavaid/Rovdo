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

it('merges an employer posting over an aggregator, retains stable saved identity and idempotent evidence', async () => {
  const { sampleJob } = await import('../../../tests/fixtures/ranking-v2');
  const store = new CareerStore(':memory:');
  try {
    const id = randomUUID();
    store.global.saveRun({
      id,
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
      profileVersion: null,
      queries: [],
      options: { sourceIds: ['himalayas'], overrides: {} },
      reason: null,
    });
    const agg = store.globalSource('agg', 'Aggregate', 'https://aggregate.example');
    const employer = store.globalSource('employer', 'Employer', 'https://careers.example');
    const base = sampleJob();
    const job = (source: typeof agg, kind: 'aggregate' | 'employer') => ({
      ...base,
      id: kind,
      source: kind === 'employer' ? ('lever' as const) : ('public-api' as const),
      canonicalUrl: 'https://careers.example/jobs/1',
      provenance: [
        {
          sourceId: source.id,
          sourceKey: 'record-' + kind,
          url: 'https://careers.example/jobs/1',
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
      discovery: {
        kind,
        availability: kind === 'employer' ? ('verified' as const) : ('unverified' as const),
        sourceName: source.company,
        sourceUrl: source.pageUrl!,
        attributionUrl: 'https://careers.example/jobs/1',
        checkedAt: 1,
        runId: id,
        exportAllowed: true,
      },
    });
    store.ingestDiscovered(id, agg, [job(agg, 'aggregate')]);
    store.saveJob('aggregate', true);
    store.ingestDiscovered(id, employer, [job(employer, 'employer')]);
    for (let i = 0; i < 3; i++) store.ingestDiscovered(id, agg, [job(agg, 'aggregate')]);
    expect(store.jobCount()).toBe(1);
    expect(store.savedIds()).toEqual(['aggregate']);
    expect(store.job('aggregate').discovery?.kind).toBe('employer');
    expect(store.job('aggregate').provenance).toHaveLength(2);
  } finally {
    store.close();
  }
});

it('keeps long ATS tenant identities distinct and migrates old saved searches to directory scope', () => {
  const store = new CareerStore(':memory:');
  try {
    const a = store.globalSource(
      'lever-' + 'x'.repeat(115) + 'a',
      'A',
      'https://careers.example/a',
    );
    const b = store.globalSource(
      'lever-' + 'x'.repeat(115) + 'b',
      'B',
      'https://careers.example/b',
    );
    expect(a.id).not.toBe(b.id);
    store.saveSearch('Before global discovery', {
      query: 'TypeScript',
      company: 'Example',
      workMode: 'all',
      savedOnly: false,
      includeExcluded: false,
    });
    expect(store.savedSearches()[0]?.search.scope).toBe('saved-companies');
  } finally {
    store.close();
  }
});
