import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { prepareRanking, rankWithProfile, BUILTIN_RANKINGS, intelligenceOf } from './scorer-v2';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
it('prepares large candidate evidence once, preserves decisions and does not stall for seconds', () => {
  const p = sampleCandidate();
  p.intelligence!.skills.push(
    ...Array.from({ length: 200 }, (_, i) => ({
      id: `large-${i}`,
      skillId: `custom:large-${i}`,
      version: null,
      depth: 'declared' as const,
      verified: true,
      evidenceIds: ['assertion'],
    })),
  );
  const rows = [{ job: sampleJob(), bm25Raw: 0 }];
  const start = performance.now();
  const prepared = prepareRanking(p, BUILTIN_RANKINGS[1]!, AS_OF);
  const first = prepared.rank(rows);
  expect(performance.now() - start).toBeLessThan(500);
  expect(first).toEqual(rankWithProfile(rows, p, BUILTIN_RANKINGS[1]!, AS_OF));
  const before = structuredClone(first);
  p.intelligence!.skills[0]!.verified = false;
  expect(prepared.rank(rows)).toEqual(before);
});
it('does not revoke distinct long-ID legacy facts sharing a shortened source prefix', () => {
  const p = sampleCandidate([]);
  p.facts = ['TypeScript', 'Rust'].map((value, i) => ({
    id: 'x'.repeat(185) + i,
    field: 'skill' as const,
    value,
    verified: true,
    source: {
      kind: 'user' as const,
      reference: 'Explicit assertion',
      capturedAt: '2026-10-17T00:00:00Z',
    },
  }));
  const intel = intelligenceOf(p);
  expect(
    intel.skills
      .filter((s) => s.verified)
      .map((s) => s.skillId)
      .sort(),
  ).toEqual(['rust', 'typescript']);
  p.facts[0]!.verified = false;
  expect(intelligenceOf(p).skills.find((s) => s.skillId === 'typescript')!.verified).toBe(false);
  expect(intelligenceOf(p).skills.find((s) => s.skillId === 'rust')!.verified).toBe(true);
});
