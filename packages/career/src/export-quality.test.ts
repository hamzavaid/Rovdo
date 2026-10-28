import { expect, it } from 'vitest';
import { exportJobs } from './job-export';
import { rankWithProfile, BUILTIN_RANKINGS } from './scorer-v2';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
it('exports eligibility separately from low qualification confidence and missing skill evidence', () => {
  const match = rankWithProfile(
    [{ job: sampleJob('Rust required'), bm25Raw: 0 }],
    sampleCandidate(),
    BUILTIN_RANKINGS[1]!,
    AS_OF,
  )[0]!;
  expect(match.review).toBe(true);
  expect(match.checks.every((c) => c.result === 'PASS')).toBe(true);
  const rows = JSON.parse(exportJobs([match], 'json').data);
  expect(rows[0]).toMatchObject({ eligibility: 'PASS', reviewRequired: true });
});
