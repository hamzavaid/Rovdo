import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { prepareRanking, rankWithProfile, BUILTIN_RANKINGS } from './scorer-v2';
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
