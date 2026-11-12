/** Conservative collection geography. Uncertain locations stay available for local ranking. */
import { COLLECTION_COUNTRIES } from '@rovdo/shared';
import type { CandidateProfile, CollectionScope, Job } from '@rovdo/shared';
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const aliases = new Map(COLLECTION_COUNTRIES.map((c) => [normalize(names.of(c)!), c]));
for (const [name, code] of Object.entries({
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  'south korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  vietnam: 'VN',
  turkey: 'TR',
}))
  aliases.set(name, code);
function countries(raw: string): string[] {
  const text = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/u\.s\.(?:a\.)?/g, 'usa');
  const normalizedText = ' ' + normalize(text) + ' ';
  const found = new Set<string>();
  for (const [name, code] of aliases) {
    // Georgia also names a US state; the bare token cannot establish a country.
    if (code === 'GE' && !/\b(?:tbilisi|country of georgia)\b/i.test(raw)) continue;
    if (normalizedText.includes(' ' + name + ' ')) found.add(code);
  }
  // Bare ISO codes are explicit only as a whole location or a delimited suffix.
  for (const part of raw.split(/[;,|]/)) {
    const code = part.trim();
    if (COLLECTION_COUNTRIES.includes(code) && code !== 'CA' && code !== 'IN') found.add(code);
  }
  if (
    /\b(?:seattle|bellevue|redmond),?\s+WA\b/i.test(raw) ||
    /\b(?:san francisco|los angeles|san diego|san jose),?\s+CA\b/i.test(raw) ||
    /\bnew york,?\s+NY\b/i.test(raw)
  )
    found.add('US');
  return [...found];
}
export function inferCollectionScope(profile: CandidateProfile | null): CollectionScope | null {
  const locations = profile?.preferences.locations ?? [];
  if (!locations.length) return null;
  const resolved = locations.map(countries);
  if (resolved.some((c) => !c.length)) return null;
  return { version: 1, countries: [...new Set(resolved.flat())], origin: 'profile' };
}
export function collectionDecision(
  job: Job,
  scope: CollectionScope,
): { include: boolean; reason: 'compatible' | 'incompatible' | 'unknown' } {
  const jurisdictions = job.details?.remoteJurisdiction ?? [];
  const locations = (
    job.workMode === 'remote' && jurisdictions.length ? jurisdictions : [job.location]
  ).filter(Boolean);
  if (
    locations.some((s) =>
      /^(?:worldwide|global|anywhere(?: in the world)?)$/i.test(
        s.replace(/\bremote\b|[-()]/gi, '').trim(),
      ),
    )
  )
    return { include: true, reason: 'compatible' };
  const parts = locations.flatMap((s) => s.split(/;|\||\bor\b/i));
  const resolved = parts.map(countries);
  if (resolved.flat().some((c) => scope.countries.includes(c)))
    return { include: true, reason: 'compatible' };
  if (!parts.length || resolved.some((c) => !c.length)) return { include: true, reason: 'unknown' };
  return { include: false, reason: 'incompatible' };
}
