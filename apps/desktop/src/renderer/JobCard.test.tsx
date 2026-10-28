import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobCard } from './JobCard';
import { sampleCandidate, sampleJob, AS_OF } from '../../../../tests/fixtures/ranking-v2';
import { rankWithProfile, BUILTIN_RANKINGS } from '@rovdo/career';
it('shows a clickable real title, meaningful score snapshot and progressive actions', () => {
  const match = rankWithProfile(
    [{ job: sampleJob(), bm25Raw: 0 }],
    sampleCandidate(),
    BUILTIN_RANKINGS[0]!,
    AS_OF,
  )[0]!;
  const html = renderToStaticMarkup(
    <JobCard
      match={match}
      saved={false}
      marker={undefined}
      rankings={BUILTIN_RANKINGS}
      reviews={[]}
      compareId="builtin:technical-balanced"
      command={async () => {}}
      onReview={() => {}}
      busy={false}
    />,
  );
  expect(html).toContain(`href="${match.job.canonicalUrl}"`);
  expect(html).toContain('More job actions');
  expect(html).toContain('Not assessed by Legacy v1');
  expect(html).toContain('Evidence confidence');
  expect(html).toContain('Save opportunity');
});
it('shows qualification uncertainty independently of passed eligibility checks', () => {
  const match = rankWithProfile(
    [{ job: sampleJob(), bm25Raw: 0 }],
    sampleCandidate(),
    BUILTIN_RANKINGS[1]!,
    AS_OF,
  )[0]!;
  match.excluded = false;
  match.review = true;
  match.checks = [{ rule: 'fixture', result: 'PASS', excerpt: 'Fixture', factIds: [] }];
  const html = renderToStaticMarkup(
    <JobCard
      match={match}
      saved={false}
      marker={undefined}
      rankings={BUILTIN_RANKINGS}
      reviews={[]}
      compareId="builtin:technical-balanced"
      command={async () => {}}
      onReview={() => {}}
      busy={false}
    />,
  );
  expect(html).toContain('Published checks passed');
  expect(html).toContain('Qualification evidence needs review');
  expect(html).not.toContain('Eligibility needs review');
});
