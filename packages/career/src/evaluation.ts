/**
 * Pure Precision@k and NDCG@k calculations for explicitly labeled comparison fixtures.
 * Regression judgments measure only their supplied corpus, not independently validated recruiting accuracy.
 */
/** Graded judgments 0..3; grades >=2 are relevant for Precision. Missing labels
 * are nonrelevant. Precision uses the fixed cutoff, including short result lists. */
export function rankingMetrics(
  rankedIds: readonly string[],
  grades: Readonly<Record<string, number>>,
  cutoff = 10,
): { precision: number; ndcg: number } {
  if (
    !Number.isInteger(cutoff) ||
    cutoff < 1 ||
    new Set(rankedIds).size !== rankedIds.length ||
    Object.values(grades).some((v) => !Number.isInteger(v) || v < 0 || v > 3)
  )
    throw new Error('INVALID_EVALUATION');
  const gains = rankedIds.slice(0, cutoff).map((id) => grades[id] ?? 0);
  const dcg = (values: number[]) =>
    values.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
  const ideal = dcg(
    Object.values(grades)
      .sort((a, b) => b - a)
      .slice(0, cutoff),
  );
  return {
    precision: gains.filter((v) => v >= 2).length / cutoff,
    ndcg: ideal ? dcg(gains) / ideal : 0,
  };
}
