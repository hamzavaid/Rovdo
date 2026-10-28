import { expect, it } from 'vitest';
import { benchmarkSummary } from './quality-summary';
it('renders only finite aggregate measurements for the CI summary', () => {
  const metrics = {
    precision: 0.5,
    ndcg: 0.8,
    precisionAt5: 0.6,
    ndcgAt5: 0.9,
    relevantRecallAt5: 0.8,
    relevantRecall: 1,
    hardConstraintFalsePositiveRate: 0,
  };
  const text = benchmarkSummary({
    summary: { baseline: metrics, current: metrics },
    runtime: { elapsedMs: 100, scoredPairs: 68, pairsPerSecond: 680 },
  });
  expect(text).toContain('| ndcg | 0.8000 | 0.8000 |');
  expect(text).toContain('provisional synthetic labels');
  expect(text).toContain('68 scored pairs');
});
it('rejects missing, nonfinite or invalid metrics instead of presenting a successful report', () => {
  for (const input of [null, {}, { summary: { baseline: { precision: NaN } }, runtime: {} }])
    expect(() => benchmarkSummary(input)).toThrow('INVALID_BENCHMARK_REPORT');
});
