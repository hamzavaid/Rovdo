import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { EMPLOYERS } from '../../job-sources/src/directory';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
import { BUILTIN_RANKINGS, rankWithProfile } from '@rovdo/career';
const search = { query: '', company: '', workMode: 'all' as const, savedOnly: false, includeExcluded: false };
it('persists a finite directory, expires policy, preserves opt-outs and canonical aliases', () => {
  const store = new CareerStore(':memory:');
  try {
    store.seedDirectory(EMPLOYERS); store.enableDirectory(Date.parse('2026-10-18'));
    expect(store.sources()).toHaveLength(4);
    const s = store.sources()[0]!.config; store.saveSource({ ...s, enabled: false });
    store.enableDirectory(Date.parse('2026-10-18')); expect(store.sources().find((x) => x.config.id === s.id)!.config.enabled).toBe(false);
    expect(store.companyIdentity('Palantir')).toBe(store.companyIdentity('Palantir Technologies'));
    expect(store.directoryAllowed({ ...s, enabled: true }, Date.parse('2027-01-01'))).toBe(false);
  } finally { store.close(); }
});
it('filters in SQL, caches scores without stale evidence and pages after score ordering', () => {
  const store = new CareerStore(':memory:'); const config = BUILTIN_RANKINGS[1]!; const profile = sampleCandidate(); let calls = 0;
  const ranker: typeof rankWithProfile = (...args) => { calls++; return rankWithProfile(...args); };
  try {
    const src = { id: '00000000-0000-4000-8000-000000000001', ats: 'greenhouse' as const, tenant: 'fixture', company: 'Fixture', enabled: false, region: 'global' as const, intervalMs: 86400000, termsReviewedAt: '2026-10-18T00:00:00Z', timezone: 'UTC', priority: 0, missingGracePolls: 3 };
    store.saveSource(src);
    const jobs = Array.from({ length: 55 }, (_, i) => ({ ...sampleJob(), id: `job:${String(i).padStart(3, '0')}`, canonicalUrl: `https://jobs.example.com/${i}`, provenance: [{ sourceId: src.id, sourceKey: `job:${i}`, url: `https://jobs.example.com/${i}`, collectedAt: 1, rawSha256: 'a'.repeat(64), fields: {} }] }));
    store.batch(src, jobs, store.sources()[0]!.state, 'one', true, 1);
    const rows = store.searchFiltered({ ...search, roleFamily: 'software' }); expect(rows).toHaveLength(55);
    rows.forEach((r) => store.cachedRanking(r, profile, config, AS_OF, ranker)); expect(calls).toBe(55);
    store.cachedRanking(rows[0]!, profile, { ...config, revision: 2, requiredMultiplier: 4 }, AS_OF, ranker); expect(calls).toBe(56);
    store.cachedRanking({ ...rows[0]!, job: { ...rows[0]!.job, company: 'Different company' } }, profile, config, AS_OF, ranker); expect(calls).toBe(57);
    rows.forEach((r) => store.cachedRanking(r, profile, config, AS_OF, ranker)); expect(calls).toBe(57);
    const changed = structuredClone(profile); changed.intelligence!.skills = [];
    store.cachedRanking(rows[0]!, changed, config, AS_OF, ranker); expect(calls).toBe(58);
    const page = store.rankedPage(rows, profile, config, AS_OF, { ...search, offset: 50 });
    expect(page.total).toBe(55); expect(page.matches).toHaveLength(5);
    expect(store.searchFiltered({ ...search, location: 'Nowhere' })).toHaveLength(0);
    store.markJob(jobs[0]!.id, { applied: true, feedback: 'relevant', seenAt: 2 });
    expect(store.searchFiltered({ ...search, hideApplied: true })).toHaveLength(54);
    expect(store.markers()[0]!.applied).toBe(true);
    const saved = store.saveSearch('Backend', { ...search, roleFamily: 'software' });
    expect(store.savedSearches()[0]!.id).toBe(saved.id); store.deleteSearch(saved.id); expect(store.savedSearches()).toEqual([]);
    expect(store.sourceRecords(jobs[0]!.id)).toHaveLength(1);
  } finally { store.close(); }
});
it('imports configurations as new identities and resets custom revisions without altering presets', () => {
  const store = new CareerStore(':memory:');
  try {
    const imported = store.importRanking(JSON.stringify(BUILTIN_RANKINGS[1]));
    expect(imported.id).not.toMatch(/^builtin:/); expect(imported.name).toContain('Technical');
    store.saveRanking({ ...imported, revision: 2, weights: { ...imported.weights, skills: 40 } });
    store.resetRanking(imported.id, 'builtin:technical-balanced');
    expect(store.rankings().find((p) => p.id === imported.id)!.weights.skills).toBe(30);
    expect(store.rankings().find((p) => p.id === imported.id)!.revision).toBe(3);
    expect(() => store.resetRanking('builtin:legacy-v1', 'builtin:technical-balanced')).toThrow();
    expect(() => store.importRanking('{"weights":{"skills":-1}}')).toThrow();
  } finally { store.close(); }
});
