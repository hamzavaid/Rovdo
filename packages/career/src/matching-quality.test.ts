/** Correctness invariants independent of provisional ranking labels. */
import { expect, it } from 'vitest';
import { rankWithProfile, BUILTIN_RANKINGS } from './scorer-v2';
import { extractRequirements, unionMonths } from './requirements';
import { roleOf, resolveSkill } from './taxonomy';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
import type { CandidateProfile, Job, RankingProfile } from '@rovdo/shared';
const config = () => structuredClone(BUILTIN_RANKINGS[1]!);
const score = (p = sampleCandidate(), j = sampleJob(), c: RankingProfile = config()) =>
  rankWithProfile([{ job: j, bm25Raw: 0 }], p, c, AS_OF)[0]!;
const part = (r: ReturnType<typeof score>, name: string) =>
  r.ranking!.components.find((c) => c.name === name)!;
it('does not reward repeated requirements or lower support when a weaker project is added', () => {
  const p = sampleCandidate(),
    j = sampleJob('Required qualifications\nTypeScript and Node.js required');
  const before = score(p, j);
  expect(
    score(p, { ...j, descriptionText: j.descriptionText + '\nTypeScript required\nTS required' })
      .score,
  ).toBe(before.score);
  p.intelligence!.projects.push({
    ...p.intelligence!.projects[0]!,
    id: 'weaker',
    skills: [],
    production: false,
  });
  expect(part(score(p, j), 'projects').value).toBeGreaterThanOrEqual(
    part(before, 'projects').value!,
  );
  p.intelligence!.projects.push({ ...p.intelligence!.projects[0]!, id: 'duplicate' });
  expect(part(score(p, j), 'projects').value).toBe(part(before, 'projects').value);
  const partial = sampleCandidate(['typescript']);
  const gap = sampleJob('Required qualifications\nTypeScript and Rust required');
  expect(
    score(partial, {
      ...gap,
      descriptionText: gap.descriptionText + '\nTypeScript required\nTS required',
    }).score,
  ).toBe(score(partial, gap).score);
});
it('matches explicit alternatives against verified project/work competencies without inventing version evidence', () => {
  const p = sampleCandidate([]);
  p.intelligence!.experience = [];
  p.intelligence!.projects[0]!.skills = ['typescript'];
  expect(score(p, sampleJob('JavaScript or TypeScript required')).ranking!.requiredCoverage).toBe(
    1,
  );
  expect(
    part(score(p, sampleJob('JavaScript or TypeScript required')), 'projects').value,
  ).toBeGreaterThan(0);
  expect(score(p, sampleJob('TypeScript >=6 required')).ranking!.requiredCoverage).toBe(0);
  p.intelligence!.projects[0]!.verified = false;
  expect(score(p, sampleJob('TypeScript required')).ranking!.requiredCoverage).toBe(0);
});
it('cannot infer relevant seniority from an unrelated role or hard-fail incomplete employment history', () => {
  const p = sampleCandidate();
  Object.assign(p.intelligence!.experience[0]!, {
    roleFamily: 'finance',
    title: 'Senior Accountant',
    level: 'senior',
  });
  const c = config();
  c.gates.experience = true;
  const result = score(
    p,
    {
      ...sampleJob('TypeScript required\n5 years of backend experience required'),
      title: 'Senior Backend Engineer',
    },
    c,
  );
  expect(part(result, 'seniority').value).toBe(0);
  expect(result.checks.find((c) => c.rule === 'experience')!.result).toBe('UNKNOWN');
});
it('keeps responsibility-only credentials inactive and certification evidence exact, current and traceable', () => {
  const p = sampleCandidate();
  p.intelligence!.certifications = [
    {
      id: 'wrong',
      name: 'CP',
      issuer: 'Fixture',
      expires: null,
      license: true,
      verified: true,
      evidenceIds: ['assertion'],
    },
  ];
  const required = sampleJob('CPA license required');
  expect(score(p, required).checks.find((c) => c.rule === 'certification')!.result).toBe('UNKNOWN');
  p.intelligence!.certifications = [
    { ...p.intelligence!.certifications[0]!, id: 'old', name: 'CPA', expires: '2020-01-01' },
    {
      ...p.intelligence!.certifications[0]!,
      id: 'new',
      name: 'CPA',
      issuer: 'Independent licensing board',
      expires: '2030-01-01',
    },
  ];
  expect(score(p, required).checks.find((c) => c.rule === 'certification')).toMatchObject({
    result: 'PASS',
    factIds: ['assertion'],
  });
  p.intelligence!.certifications.reverse();
  expect(score(p, required).checks.find((c) => c.rule === 'certification')!.result).toBe('PASS');
  p.intelligence!.certifications = [{ ...p.intelligence!.certifications[0]!, expires: '2026' }];
  expect(score(p, required).checks.find((c) => c.rule === 'certification')!.result).toBe('UNKNOWN');
  expect(
    part(score(p, sampleJob('Responsibilities\nReview Bachelor degree transcripts')), 'education')
      .value,
  ).toBeNull();
});
it('accepts an explicitly alternative credential without failing on a different expired credential', () => {
  const p = sampleCandidate();
  p.intelligence!.certifications = [
    {
      id: 'expired',
      name: 'CPA',
      issuer: 'Fixture',
      expires: '2020-01-01',
      license: true,
      verified: true,
      evidenceIds: ['assertion'],
    },
    {
      id: 'current',
      name: 'PMP',
      issuer: 'Fixture',
      expires: '2030-01-01',
      license: true,
      verified: true,
      evidenceIds: ['assertion'],
    },
  ];
  expect(
    score(p, sampleJob('CPA or PMP certification required'))
      .checks.filter((c) => c.rule === 'certification')
      .map((c) => c.result),
  ).toEqual(['PASS']);
});
it('recognizes inline ATS qualification sections and keeps mentioned/ambiguous years out of mandatory gates', () => {
  const parsed = extractRequirements(
    'Preferred qualifications: Python\nMinimum qualifications: SQL',
    'Data Analyst',
  );
  expect(parsed.items.find((r) => r.skillId === 'python')!.importance).toBe('preferred');
  expect(parsed.items.find((r) => r.skillId === 'sql')!.importance).toBe('required');
  const c = config();
  c.gates.experience = true;
  expect(
    score(
      sampleCandidate(),
      sampleJob('TypeScript required\nPreferred qualifications: 10 years of backend experience'),
      c,
    ).checks.filter((x) => x.rule === 'experience'),
  ).toHaveLength(0);
});
it('supports curated non-software domains without equating unrelated engineering roles', () => {
  expect(roleOf('Senior Mechanical Engineer').family).toBe('mechanical');
  expect(roleOf('Electrical Engineer').family).toBe('electrical');
  expect(roleOf('Accountant').family).toBe('finance');
  expect(resolveSkill('Microsoft Excel', 'skill')?.id).toBe('excel');
  expect(resolveSkill('GD&T', 'skill')?.id).toBe('gd-and-t');
});
it('rejects invalid calendar as-of/duration dates rather than normalizing impossible dates', () => {
  expect(() => score(sampleCandidate(), sampleJob(), config())).not.toThrow();
  expect(() => rankWithProfile([], sampleCandidate(), config(), '2026-02-30')).toThrow(
    'AS_OF_REQUIRED',
  );
  expect(unionMonths([{ start: '2025-02-30', end: '2025-03-31' }], AS_OF)).toBe(0);
});
it('never treats contradictory supporting evidence as an established qualification', () => {
  const p: CandidateProfile = sampleCandidate();
  p.intelligence!.evidence.push({
    ...p.intelligence!.evidence[0]!,
    id: 'contradiction',
    stance: 'contradicts',
  });
  for (const item of [
    ...p.intelligence!.skills,
    ...p.intelligence!.experience,
    ...p.intelligence!.projects,
  ])
    item.evidenceIds.push('contradiction');
  const j: Job = sampleJob('TypeScript required');
  expect(score(p, j).ranking!.requiredCoverage).toBe(0);
  expect(score(p, j).matchedSkills).toEqual([]);
});
it('does not infer qualifications from an incomplete candidate or reward record order', () => {
  const p = sampleCandidate();
  const before = score(p);
  for (const rows of [
    p.intelligence!.skills,
    p.intelligence!.projects,
    p.intelligence!.experience,
    p.intelligence!.education,
    p.intelligence!.evidence,
  ])
    rows.reverse();
  expect(score(p)).toEqual(before);
  p.intelligence!.skills = [];
  p.intelligence!.experience = [];
  p.intelligence!.projects = [];
  p.intelligence!.education = [];
  p.facts = [];
  const empty = score(p, sampleJob('TypeScript required\nBachelor degree required'));
  expect(empty.score).toBe(0);
  expect(empty.confidence).toBe(0);
  expect(empty.ranking!.requiredCoverage).toBe(0);
  expect(empty.review).toBe(true);
  expect(empty.checks.find((c) => c.rule === 'education')!.result).toBe('UNKNOWN');
});
