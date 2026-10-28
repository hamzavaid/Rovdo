/** Publish aggregate synthetic-corpus measurements only; never upload candidate or source content. */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function benchmarkSummary(input: unknown): string {
  const report = input as {
    summary?: Record<string, Record<string, unknown>>;
    runtime?: Record<string, unknown>;
  };
  const metrics = [
    'precision',
    'ndcg',
    'precisionAt5',
    'ndcgAt5',
    'relevantRecallAt5',
    'relevantRecall',
    'hardConstraintFalsePositiveRate',
  ];
  if (
    !report ||
    !report.summary ||
    !report.runtime ||
    metrics.some((k) =>
      ['baseline', 'current'].some(
        (v) =>
          typeof report.summary?.[v]?.[k] !== 'number' ||
          !Number.isFinite(report.summary[v]![k]) ||
          Number(report.summary[v]![k]) < 0 ||
          Number(report.summary[v]![k]) > 1,
      ),
    ) ||
    ['elapsedMs', 'scoredPairs', 'pairsPerSecond'].some(
      (k) =>
        typeof report.runtime![k] !== 'number' ||
        !Number.isFinite(report.runtime![k]) ||
        Number(report.runtime![k]) <= 0,
    )
  )
    throw new Error('INVALID_BENCHMARK_REPORT');
  return [
    '## Matching benchmark (provisional synthetic labels)',
    '',
    '| Metric | Baseline | Current |',
    '| --- | ---: | ---: |',
    ...metrics.map(
      (k) =>
        `| ${k} | ${Number(report.summary!.baseline![k]).toFixed(4)} | ${Number(report.summary!.current![k]).toFixed(4)} |`,
    ),
    '',
    `${report.runtime.scoredPairs} scored pairs in ${Number(report.runtime.elapsedMs).toFixed(1)} ms (${Number(report.runtime.pairsPerSecond).toFixed(1)} pairs/s).`,
    '',
    'Runtime is host-dependent; this corpus is not independent recruiter validation. Detailed per-job results are generated locally in artifacts/matching-benchmark.json.',
    '',
  ].join('\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = benchmarkSummary(
    JSON.parse(readFileSync('artifacts/matching-benchmark.json', 'utf8')),
  );
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
