import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { BUILTIN_RANKINGS, extractRequirements } from '@rovdo/career';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
it('does not trust a repeated upstream content hash when actual scoring text changed', () => {
  const store = new CareerStore(':memory:');
  try {
    const source = store.globalSource('fixture', 'Fixture', 'https://jobs.example.com');
    const job = sampleJob('TypeScript required');
    job.provenance = [
      {
        sourceId: source.id,
        sourceKey: job.id,
        url: job.canonicalUrl,
        collectedAt: 1,
        rawSha256: job.rawSha256,
        fields: {},
      },
    ];
    store.batch(source, [job], store.sources()[0]!.state, 'one', true, 1);
    expect(store.reviewRetrieval(job.id, 'TypeScript')).toBe(
      store.search('TypeScript')[0]!.bm25Raw,
    );
    const config = BUILTIN_RANKINGS[1]!,
      profile = sampleCandidate();
    const before = store.cachedRanking({ job, bm25Raw: 0 }, profile, config, AS_OF);
    const changed = { ...job, descriptionText: 'Rust required' };
    const after = store.cachedRanking({ job: changed, bm25Raw: 0 }, profile, config, AS_OF);
    expect(after.score).toBeLessThan(before.score);
    expect(after.gaps).toContain('rust');
    expect(store.cacheStats.misses).toBe(2);
    // Title/description positions are semantic, even when their strings are swapped.
    store.cachedRanking(
      { job: { ...job, title: job.descriptionText, descriptionText: job.title }, bm25Raw: 0 },
      profile,
      config,
      AS_OF,
    );
    expect(store.cacheStats.misses).toBe(3);
  } finally {
    store.close();
  }
});
it('refreshes old search metadata cooperatively without rewriting saved jobs', async () => {
  const store = new CareerStore(':memory:');
  try {
    const source = store.globalSource('fixture', 'Fixture', 'https://jobs.example.com');
    const job = sampleJob('Required: SolidWorks.');
    job.title = 'Mechanical Engineer';
    job.details = {
      employmentType: 'unknown',
      remoteJurisdiction: [],
      season: 'unknown',
      country: '',
      requirements: extractRequirements(job.descriptionText, job.title),
      roleFamily: 'software',
    };
    job.provenance = [
      {
        sourceId: source.id,
        sourceKey: job.id,
        url: job.canonicalUrl,
        collectedAt: 1,
        rawSha256: job.rawSha256,
        fields: {},
      },
    ];
    store.batch(source, [job], store.sources()[0]!.state, 'one', true, 1);
    await store.refreshSearchMetadata();
    expect(
      store.searchFiltered({
        query: '',
        company: '',
        workMode: 'all',
        savedOnly: false,
        includeExcluded: false,
        roleFamily: 'mechanical',
      }),
    ).toHaveLength(1);
    expect(store.jobs()[0]!.details!.roleFamily).toBe('software');
    expect(store.setting('search-metadata-policy')).toContain('rovdo-taxonomy-3');
  } finally {
    store.close();
  }
});
it('marks possible duplicates without repeatedly rewriting every existing sibling', () => {
  const store = new CareerStore(':memory:');
  try {
    const source = store.globalSource('duplicate-load', 'Fixture', 'https://jobs.example.com');
    const rows = Array.from({ length: 40 }, (_, i) => ({
      ...sampleJob('TypeScript required'),
      id: `sibling:${i}`,
      canonicalUrl: `https://jobs.example.com/${i}`,
      provenance: [
        {
          sourceId: source.id,
          sourceKey: String(i),
          url: `https://jobs.example.com/${i}`,
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    }));
    const db = (store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    const before = Number(db.prepare('SELECT total_changes() AS n').get()!.n);
    store.batch(source, rows, store.sources()[0]!.state, 'fixture', false, 1);
    expect(store.jobCount()).toBe(rows.length);
    expect(store.jobs().every((j) => j.duplicateGroup !== null)).toBe(true);
    expect(Number(db.prepare('SELECT total_changes() AS n').get()!.n) - before).toBeLessThan(
      rows.length * 40,
    );
  } finally {
    store.close();
  }
});
it('retains observation time when a cached second source cannot replace authoritative fields', () => {
  const store = new CareerStore(':memory:');
  try {
    const a = store.globalSource('original', 'Fixture', 'https://jobs.example.com'),
      b = store.globalSource('cached', 'Fixture', 'https://other.example.com');
    const job = sampleJob('TypeScript required');
    for (const source of [a, b])
      store.batch(
        source,
        [
          {
            ...job,
            source: source === a ? 'greenhouse' : 'lever',
            provenance: [
              {
                sourceId: source.id,
                sourceKey: 'same',
                url: job.canonicalUrl,
                collectedAt: 1,
                rawSha256: 'a'.repeat(64),
                fields: {},
              },
            ],
          },
        ],
        store.sources().find((s) => s.config.id === source.id)!.state,
        'fixture',
        false,
        99999,
      );
    expect(store.job(job.id).lastSeenAt).toBe(1);
    expect(store.job(job.id).provenance).toHaveLength(2);
  } finally {
    store.close();
  }
});
