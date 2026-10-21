/** Event-loop regressions: large local searches must yield without changing ranking results. */
import { expect, it } from 'vitest';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { CareerStore } from './career';
import { BUILTIN_RANKINGS } from '@rovdo/career';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
const search = {
  query: '',
  company: '',
  workMode: 'all' as const,
  savedOnly: false,
  includeExcluded: false,
};
it('yields during cache preparation and serializes overlapping searches without mixing results', async () => {
  const store = new CareerStore(':memory:');
  try {
    const source = store.globalSource('responsive', 'Fixture', 'https://careers.example');
    const rows = Array.from({ length: 40 }, (_, i) => ({
      job: {
        ...sampleJob(),
        id: 'responsive-' + i,
        canonicalUrl: 'https://careers.example/' + i,
        provenance: [
          {
            sourceId: source.id,
            sourceKey: String(i),
            url: 'https://careers.example/' + i,
            collectedAt: 1,
            rawSha256: 'a'.repeat(64),
            fields: {},
          },
        ],
      },
      bm25Raw: 0,
    }));
    store.batch(
      source,
      rows.map((r) => r.job),
      store.sources()[0]!.state,
      'test',
      false,
      1,
    );
    let turns = 0,
      done = false;
    const heartbeat = (async () => {
      while (!done) {
        await yieldTurn();
        turns++;
      }
    })();
    const profile = sampleCandidate(),
      config = BUILTIN_RANKINGS[1]!;
    const [first, second] = await Promise.all([
      store.rankedPageAsync(rows.slice(0, 20), profile, config, AS_OF, search),
      store.rankedPageAsync(rows.slice(20), profile, config, AS_OF, search),
    ]);
    done = true;
    await heartbeat;
    expect(turns).toBeGreaterThan(2);
    expect(first.total).toBe(20);
    expect(second.total).toBe(20);
    expect(
      first.matches.filter((m) => second.matches.some((n) => m.job.id === n.job.id)).length,
    ).toBe(0);
    const sync = store.rankedPage(rows.slice(0, 20), profile, config, AS_OF, search);
    expect(first.matches.map((m) => [m.job.id, m.score])).toEqual(
      sync.matches.map((m) => [m.job.id, m.score]),
    );
  } finally {
    store.close();
  }
});

it('yields between ingestion transactions and never advances a canceled page checkpoint', async () => {
  const store = new CareerStore(':memory:');
  try {
    const source = store.globalSource('ingestion', 'Fixture', 'https://careers.example');
    const state = store.sources()[0]!.state;
    const jobs = Array.from({ length: 24 }, (_, i) => ({
      ...sampleJob(),
      id: 'ingest-' + i,
      canonicalUrl: 'https://careers.example/' + i,
      provenance: [
        {
          sourceId: source.id,
          sourceKey: String(i),
          url: 'https://careers.example/' + i,
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    }));
    const controller = new AbortController();
    setImmediate(() => controller.abort());
    await expect(
      store.batchAsync(
        source,
        jobs,
        { ...state, cursor: '100', lastSuccessAt: 100 },
        'page',
        true,
        1,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(store.sources()[0]!.state.cursor).toBe(state.cursor);
    await store.batchAsync(source, jobs, { ...state, cursor: '100' }, 'page', false, 1);
    expect(store.jobCount()).toBe(24);
    expect(store.sources()[0]!.state.cursor).toBe('100');
  } finally {
    store.close();
  }
});
it('yields while normalizing a feed and preserves synchronous adapter results', async () => {
  const { AtsAdapter } = await import('@rovdo/job-sources');
  const store = new CareerStore(':memory:');
  try {
    const source = {
      ...store.globalSource('parsing', 'Fixture', 'https://careers.example'),
      ats: 'greenhouse' as const,
    };
    const adapter = new AtsAdapter(source);
    const payload = {
      jobs: Array.from({ length: 24 }, (_, id) => ({
        id,
        title: 'Engineer',
        content: 'Required: TypeScript',
        absolute_url: 'https://careers.example/' + id,
        location: { name: 'Remote' },
      })),
    };
    let heartbeat = false;
    setImmediate(() => {
      heartbeat = true;
    });
    const result = await adapter.normalizeDetailedAsync(payload, new AbortController().signal);
    expect(heartbeat).toBe(true);
    expect(result.jobs.map((j) => [j.id, j.contentSha256])).toEqual(
      adapter.normalize(payload).map((j) => [j.id, j.contentSha256]),
    );
  } finally {
    store.close();
  }
});

it('reuses an unchanged search on polling and invalidates it after job writes', async () => {
  const store = new CareerStore(':memory:');
  try {
    const source = store.globalSource('reuse', 'Fixture', 'https://careers.example');
    const job = {
      ...sampleJob(),
      id: 'reuse',
      canonicalUrl: 'https://careers.example/reuse',
      provenance: [
        {
          sourceId: source.id,
          sourceKey: 'reuse',
          url: 'https://careers.example/reuse',
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    };
    store.batch(
      source,
      Array.from({ length: 3 }, (_, i) => ({
        ...job,
        id: i ? 'reuse-' + i : job.id,
        requisitionId: null,
        canonicalUrl: job.canonicalUrl + '/' + i,
      })),
      store.sources()[0]!.state,
      'first',
      false,
      1,
    );
    const profile = sampleCandidate(),
      config = BUILTIN_RANKINGS[1]!;
    const first = await store.rankedPageAsync(
      store.iterateFiltered(search),
      profile,
      config,
      AS_OF,
      search,
      1,
      true,
    );
    expect(first.pending).toBe(2);
    let scans = 0;
    function* rows() {
      scans++;
      yield { job, bm25Raw: 0 };
    }
    expect(
      (await store.rankedPageAsync(rows(), profile, config, AS_OF, search, 1, true)).pending,
    ).toBe(1);
    expect(
      (await store.rankedPageAsync(rows(), profile, config, AS_OF, search, 1, true)).pending,
    ).toBe(0);
    expect(scans).toBe(0);
    store.batch(source, [job], store.sources()[0]!.state, 'second', false, 2);
    await store.rankedPageAsync(rows(), profile, config, AS_OF, search, 200, true);
    expect(scans).toBe(1);
  } finally {
    store.close();
  }
});
