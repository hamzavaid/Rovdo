import { expect, it } from 'vitest';
import { parseJobRows, exportJobs } from './discovery-files';
import { sampleCandidate, sampleJob } from '../../../../tests/fixtures/ranking-v2';
import { rankWithProfile, BUILTIN_RANKINGS } from '@rovdo/career';
it('imports quoted/multiline JobSpy CSV without losing commas or descriptions', () => {
  expect(
    [
      ...parseJobRows(
        'title,company,description,job_url\n"Engineer, II",Example,"Python\nSQL",https://careers.example/jobs/1',
        'csv',
      ),
    ][0],
  ).toMatchObject({ title: 'Engineer, II', description: 'Python\nSQL' });
});
it('exports page scores safely and does not redistribute feeds with restrictive export terms', () => {
  const match = rankWithProfile(
    [{ job: sampleJob(), bm25Raw: 0 }],
    sampleCandidate(),
    BUILTIN_RANKINGS[1]!,
    '2026-10-21',
  )[0]!;
  match.job.title = '=HYPERLINK("bad")';
  expect(exportJobs([match], 'csv').data).toContain("'=HYPERLINK");
  match.job.discovery = {
    kind: 'aggregate',
    availability: 'unverified',
    sourceName: 'Himalayas',
    sourceUrl: 'https://himalayas.app',
    attributionUrl: 'https://himalayas.app/jobs/1',
    checkedAt: 1,
    runId: '00000000-0000-4000-8000-000000000001',
    exportAllowed: false,
  };
  expect(exportJobs([match], 'json').skipped).toBe(1);
});
