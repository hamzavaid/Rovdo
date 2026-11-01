import { expect, it } from 'vitest';
import { reviewPayload, BUILTIN_RANKINGS, rankWithProfile } from './index';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
it('uses the selected scorer and canonical verified evidence without protected facts or private source paths', () => {
  const p = sampleCandidate(),
    j = sampleJob('Doctorate degree required');
  const config = BUILTIN_RANKINGS[1]!;
  const payload = reviewPayload(p, [j], { ranking: config, asOf: AS_OF });
  expect(payload.scorerVersion).toBe(
    rankWithProfile([{ job: j, bm25Raw: 0 }], p, config, AS_OF)[0]!.scorerVersion,
  );
  expect(payload.facts.some((f) => f.field === 'skill' && f.value.includes('typescript'))).toBe(
    true,
  );
  expect(payload.jobs[0]!.checks.some((c) => c.result === 'FAIL')).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('sourceId');
  expect(reviewPayload(p, [j], { ranking: BUILTIN_RANKINGS[0]!, asOf: AS_OF }).scorerVersion).toBe(
    'deterministic-v1',
  );
});
