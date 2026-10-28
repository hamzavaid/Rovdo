/** Reproducible offline benchmark. Baseline capture is explicit; ordinary runs never rewrite it. */
import { expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { matchingBenchmark, BENCHMARK_AS_OF } from '../../../tests/fixtures/matching-benchmark';
import { rankWithProfile, BUILTIN_RANKINGS, SCORING_POLICY_VERSION } from './scorer-v2';
import { rankingMetrics } from './evaluation';
import { REQUIREMENTS_PARSER_VERSION } from './requirements';
import { TAXONOMY_VERSION } from './taxonomy';
const config = BUILTIN_RANKINGS.find((p) => p.id === 'builtin:technical-balanced')!;
it('reports baseline versus current quality, consistency and runtime on a fixed multi-domain corpus', () => {
  const started = performance.now();
  const scenarios = matchingBenchmark.scenarios.map((s) => {
    const rows = s.jobs.map((c) => ({ job: c.job, bm25Raw: 0 }));
    const results = rankWithProfile(rows, s.candidate, config, BENCHMARK_AS_OF);
    const visible = results.filter((r) => !r.excluded),
      grades = Object.fromEntries(s.jobs.map((c) => [c.job.id, c.grade]));
    const ids = visible.map((r) => r.job.id),
      relevant = s.jobs.filter((j) => j.grade >= 2),
      hard = s.jobs.filter((j) => j.hardMismatch);
    const repeat = rankWithProfile([...rows].reverse(), s.candidate, config, BENCHMARK_AS_OF);
    expect(repeat).toEqual(results);
    expect(results.every((r) => Number.isFinite(r.score) && r.score >= 0 && r.score <= 100)).toBe(
      true,
    );
    return {
      id: s.id,
      metrics: {
        ...rankingMetrics(ids, grades, 10),
        precisionAt5: rankingMetrics(ids, grades, 5).precision,
        ndcgAt5: rankingMetrics(ids, grades, 5).ndcg,
        relevantRecallAt5: relevant.length
          ? relevant.filter((j) => ids.slice(0, 5).includes(j.job.id)).length / relevant.length
          : 0,
        relevantRecall: relevant.length
          ? relevant.filter((j) => ids.includes(j.job.id)).length / relevant.length
          : 0,
        hardConstraintFalsePositiveRate: hard.length
          ? hard.filter((j) => ids.includes(j.job.id)).length / hard.length
          : 0,
      },
      ranking: results.map((r) => ({
        id: r.job.id,
        score: r.score,
        confidence: r.confidence,
        excluded: r.excluded,
        review: r.review,
      })),
      stable: true,
    };
  });
  const elapsedMs = performance.now() - started;
  const current = {
    corpus: matchingBenchmark.version,
    labelSource: matchingBenchmark.labelSource,
    asOf: BENCHMARK_AS_OF,
    scorer: SCORING_POLICY_VERSION,
    parser: REQUIREMENTS_PARSER_VERSION,
    taxonomy: TAXONOMY_VERSION,
    scenarios,
  };
  const baselinePath = 'tests/fixtures/matching-baseline.json';
  if (process.env.ROVDO_CAPTURE_MATCHING_BASELINE === '1')
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof current;
  expect(baseline.corpus).toBe(current.corpus);
  const mean = (data: typeof current, key: keyof (typeof scenarios)[number]['metrics']) =>
    data.scenarios.reduce((sum, s) => sum + s.metrics[key], 0) / data.scenarios.length;
  const summary = {
    baseline: Object.fromEntries(
      Object.keys(scenarios[0]!.metrics).map((k) => [
        k,
        mean(baseline, k as keyof (typeof scenarios)[number]['metrics']),
      ]),
    ),
    current: Object.fromEntries(
      Object.keys(scenarios[0]!.metrics).map((k) => [
        k,
        mean(current, k as keyof (typeof scenarios)[number]['metrics']),
      ]),
    ),
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/matching-benchmark.json',
    JSON.stringify(
      {
        baseline,
        current,
        summary,
        runtime: {
          elapsedMs,
          scoredPairs: scenarios.reduce((n, s) => n + s.ranking.length, 0) * 2,
          pairsPerSecond:
            ((scenarios.reduce((n, s) => n + s.ranking.length, 0) * 2) / elapsedMs) * 1000,
          node: process.version,
          platform: process.platform,
        },
        limitations:
          'Provisional synthetic labels. Runtime includes cold parsing and two scoring passes; host-dependent, not a production SLA.',
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write('Matching benchmark (provisional): ' + JSON.stringify(summary) + '\n');
  // Regression floors on this frozen corpus, not a claim of external recruiting accuracy.
  for (const key of ['precision', 'ndcg', 'relevantRecallAt5', 'relevantRecall'])
    expect(summary.current[key]!).toBeGreaterThanOrEqual(summary.baseline[key]! - 1e-12);
  expect(summary.current.hardConstraintFalsePositiveRate!).toBeLessThanOrEqual(
    summary.baseline.hardConstraintFalsePositiveRate!,
  );
});
