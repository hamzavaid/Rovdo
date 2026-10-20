import { expect, it, vi } from 'vitest';
const taxonomy = vi.hoisted(() => ({ value: 'rovdo-taxonomy-1' }));
vi.mock('@rovdo/career', async (original) => ({
  ...(await original<typeof import('@rovdo/career')>()),
  get TAXONOMY_VERSION() {
    return taxonomy.value;
  },
}));
import { CareerStore } from './career';
import { BUILTIN_RANKINGS, rankWithProfile } from '@rovdo/career';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
it('recalculates unchanged jobs/evidence when the taxonomy version changes', () => {
  const store = new CareerStore(':memory:');
  const ranker = vi.fn(rankWithProfile);
  const row = { job: sampleJob(), bm25Raw: 0 };
  const profile = sampleCandidate();
  const source = {
    id: '00000000-0000-4000-8000-000000000001',
    ats: 'greenhouse' as const,
    tenant: 'fixture',
    company: 'Fixture',
    enabled: false,
    region: 'global' as const,
    intervalMs: 86400000,
    termsReviewedAt: '2026-10-19T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 3,
  };
  store.saveSource(source);
  row.job.provenance = [
    {
      sourceId: source.id,
      sourceKey: row.job.id,
      url: row.job.canonicalUrl,
      collectedAt: 1,
      rawSha256: 'b'.repeat(64),
      fields: {},
    },
  ];
  store.batch(source, [row.job], store.sources()[0]!.state, 'fixture', true, 1);
  try {
    store.cachedRanking(row, profile, BUILTIN_RANKINGS[1]!, AS_OF, ranker);
    store.cachedRanking(row, profile, BUILTIN_RANKINGS[1]!, AS_OF, ranker);
    expect(ranker).toHaveBeenCalledTimes(1);
    taxonomy.value = 'rovdo-taxonomy-2';
    store.cachedRanking(row, profile, BUILTIN_RANKINGS[1]!, AS_OF, ranker);
    expect(ranker).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
  }
});
