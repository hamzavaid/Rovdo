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
