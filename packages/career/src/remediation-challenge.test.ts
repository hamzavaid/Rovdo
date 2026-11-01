/** Versioned challenge fixtures are provisional correctness judgments, separate from the frozen ranking benchmark. */
import { expect, it } from 'vitest';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
import {
  BUILTIN_RANKINGS,
  rankWithProfile,
  eligibilityOutcome,
  extractRequirements,
} from './index';
const rank = (text: string) =>
  rankWithProfile(
    [{ job: sampleJob(text), bm25Raw: 0 }],
    sampleCandidate(),
    BUILTIN_RANKINGS[1]!,
    AS_OF,
  )[0]!;
it('retains mixed mandatory legal clauses as unresolved and prevents automatic shortlisting', () => {
  const m = rank(
    'TypeScript required\nU.S. citizenship is required. Active TS/SCI clearance is required.',
  );
  expect(eligibilityOutcome(m)).toBe('UNKNOWN');
  expect(m.checks.filter((c) => c.rule === 'citizenship' || c.rule === 'clearance')).toHaveLength(
    2,
  );
  expect(m.ranking!.shortlist).toBe(false);
  expect(m.checks.some((c) => c.result === 'UNKNOWN' && c.excerpt.includes('TS/SCI'))).toBe(true);
});
it.each([
  'Salesforce CPQ and Apex required',
  'TypeScript and Apex required',
  'Registered aviation mechanic qualification required',
])('retains opaque mandatory qualifications: %s', (text) => {
  const m = rank(text);
  expect(m.ranking!.assessment!.complete).toBe(false);
  expect(m.ranking!.requiredCoverage).toBeLessThan(1);
  expect(m.ranking!.shortlist).toBe(false);
  expect(m.review).toBe(true);
  expect(extractRequirements(text, 'Engineer').items.some((r) => r.kind === 'unknown')).toBe(true);
});
it('distinguishes unpublished requirements and negated requirements from unsupported ones', () => {
  expect(rank('Join our team.').ranking!.assessment!.status).toBe('not-published');
  expect(
    rank('No citizenship or clearance required.\nTypeScript required').checks.some(
      (c) => c.rule === 'citizenship' || c.rule === 'clearance',
    ),
  ).toBe(false);
});
it.each([
  ['US', 'Australia', 'FAIL'],
  ['US', 'United States', 'PASS'],
  ['Canada', 'California, US', 'FAIL'],
  ['CA', 'Canada', 'UNKNOWN'],
  ['California', 'San Francisco, CA', 'PASS'],
  ['California', 'Toronto, CA', 'UNKNOWN'],
  ['US', 'Unspecified city, CA', 'UNKNOWN'],
  ['US', 'Remote', 'UNKNOWN'],
  ['US', 'Toronto, Canada; New York, USA', 'PASS'],
])('hard location %s versus %s is %s', (preference, location, expected) => {
  const p = sampleCandidate();
  p.preferences.locations = [preference];
  const m = rankWithProfile(
    [{ job: { ...sampleJob('TypeScript required'), location, workMode: 'onsite' }, bm25Raw: 0 }],
    p,
    BUILTIN_RANKINGS[1]!,
    AS_OF,
  )[0]!;
  expect(m.checks.find((c) => c.rule === 'location')!.result).toBe(expected);
});
it('attributes alternatives to the supported candidate skill and evidence', () => {
  const m = rank('Java or TypeScript required');
  expect(m.matchedSkills).toEqual(['typescript']);
  expect(m.ranking!.requirements[0]!.matchedSkillId).toBe('typescript');
  expect(m.ranking!.requirements[0]!.evidenceIds).toContain('assertion');
});
it('does not let one negated legal clause erase another mandatory restriction', () => {
  const m = rank('TypeScript required\nCitizenship not required but active clearance required');
  expect(m.checks.some((c) => c.rule === 'clearance' && c.result === 'UNKNOWN')).toBe(true);
  expect(m.ranking!.shortlist).toBe(false);
});
it('preserves opaque export-control restrictions and keeps preferred legal terms soft', () => {
  expect(
    rank('TypeScript required\nMust satisfy ITAR export-control eligibility').checks.some(
      (c) => c.rule === 'legal-unresolved' && c.result === 'UNKNOWN',
    ),
  ).toBe(true);
  expect(
    rank('TypeScript required\nPreferred Qualifications\nActive clearance').checks.some(
      (c) => c.rule === 'clearance',
    ),
  ).toBe(false);
});
it('never interprets a country-scoped negative authorization as a positive country match', () => {
  const p = sampleCandidate();
  p.facts.push({
    id: 'negative',
    field: 'workAuthorization',
    value: 'US:no',
    verified: true,
    source: { kind: 'user', reference: 'Explicit assertion', capturedAt: '2026-10-17T00:00:00Z' },
  });
  const m = rankWithProfile(
    [{ job: sampleJob('TypeScript required\nWork authorization: US required'), bm25Raw: 0 }],
    p,
    BUILTIN_RANKINGS[1]!,
    AS_OF,
  )[0]!;
  expect(m.checks.find((c) => c.rule === 'workAuthorization')!.result).toBe('FAIL');
});
it('keeps legacy weights while preventing expired or unresolved mandatory jobs from automatic shortlisting', () => {
  const config = { ...BUILTIN_RANKINGS[0]!, thresholds: { score: 0, confidence: 0, coverage: 0 } };
  const job = { ...sampleJob('TypeScript required'), validThrough: '2026-01-01' };
  const expired = rankWithProfile([{ job, bm25Raw: 0 }], sampleCandidate(), config, AS_OF)[0]!;
  expect(expired.excluded).toBe(true);
  const unknown = rankWithProfile(
    [
      {
        job: sampleJob('TypeScript required. Must comply with ITAR export restrictions.'),
        bm25Raw: 0,
      },
    ],
    sampleCandidate(),
    config,
    AS_OF,
  )[0]!;
  expect(unknown.ranking!.shortlist).toBe(false);
});
it.each([
  'No clearance required and U.S. citizenship required',
  'U.S. citizenship required and no clearance required',
])('scopes legal negations to their own conjunction: %s', (text) => {
  const m = rank(`TypeScript required\n${text}`);
  expect(m.checks.some((c) => c.rule === 'citizenship' && c.result === 'UNKNOWN')).toBe(true);
  expect(m.checks.some((c) => c.rule === 'clearance')).toBe(false);
  expect(m.ranking!.shortlist).toBe(false);
});
