import { expect, it } from 'vitest';
import { rankingMetrics } from './evaluation';
import { comparisonFixture } from '../../../tests/fixtures/comparison-v2';
import { BUILTIN_RANKINGS, rankWithProfile } from './scorer-v2';
import { AS_OF, sampleCandidate } from '../../../tests/fixtures/ranking-v2';

it('computes graded NDCG and binary Precision@10 without claiming recruiter validation', () => {
  expect(rankingMetrics(['a', 'b'], { a: 3, b: 0 }, 10).precision).toBe(.1);
  expect(rankingMetrics(['b', 'a'], { a: 3, b: 0 }, 2).ndcg).toBeCloseTo(1 / Math.log2(3));
  expect(rankingMetrics([], {}, 10)).toEqual({ precision: 0, ndcg: 0 });
  expect(() => rankingMetrics(['a', 'a'], { a: 3 }, 10)).toThrow();
});
it('retains deterministic provisional comparisons across all five methods', () => {
  expect(comparisonFixture.labelSource).toBe('provisional-hand-authored');
  const judgments = Object.fromEntries(comparisonFixture.jobs.map((x) => [x.job.id, x.grade]));
  for (const preset of BUILTIN_RANKINGS) {
    const rows = comparisonFixture.jobs.map(({ job }) => ({ job, bm25Raw: 0 }));
    const results = rankWithProfile(rows, sampleCandidate(), preset, AS_OF);
    const metric = rankingMetrics(results.filter((r) => !r.excluded).map((r) => r.job.id), judgments, 10);
    expect(metric.precision).toBeGreaterThanOrEqual(0); expect(metric.precision).toBeLessThanOrEqual(1);
    expect(metric.ndcg).toBeGreaterThanOrEqual(0); expect(metric.ndcg).toBeLessThanOrEqual(1);
    expect(rankWithProfile([...rows].reverse(), sampleCandidate(), preset, AS_OF).map((r) => r.job.id)).toEqual(results.map((r) => r.job.id));
    process.stdout.write(`${preset.name}: provisional P@10=${metric.precision.toFixed(3)}, NDCG@10=${metric.ndcg.toFixed(3)}\n`);
  }
});
