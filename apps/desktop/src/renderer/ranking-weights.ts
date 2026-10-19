/** Percentage drafts only; saved relative weights and presets remain unchanged. */
export function totalWeight(weights: Record<string, number>): number {
  return Math.round(Object.values(weights).reduce((sum, n) => sum + n, 0) * 1e8) / 1e8;
}
export function editorWeights<T extends Record<string, number>>(weights: T): T {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) < 1e-8 && Object.values(weights).every((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-8)) return { ...weights };
  if (!total) return { ...weights };
  const parts = Object.entries(weights).map(([key, value], index) => ({ key, index, exact: value / total * 1000, units: Math.floor(value / total * 1000) }));
  let remaining = 1000 - parts.reduce((sum, p) => sum + p.units, 0);
  for (const p of [...parts].sort((a, b) => (b.exact - b.units) - (a.exact - a.units) || a.index - b.index)) { if (remaining-- > 0) p.units++; }
  return Object.fromEntries(parts.map((p) => [p.key, p.units / 10])) as T;
}
export function setWeight<T extends Record<string, number>>(weights: T, key: keyof T, requested: number): T {
  if (!Number.isFinite(requested)) return weights;
  const other = Object.entries(weights).filter(([k]) => k !== key).reduce((sum, [, value]) => sum + value, 0);
  const maximum = Math.max(0, Math.floor((100 - other + 1e-8) * 10) / 10);
  return { ...weights, [key]: Math.min(maximum, Math.max(0, Math.round(requested * 10) / 10)) };
}
