import { describe, expect, it } from 'vitest';
import { JobSchema } from '@rovdo/shared';
import type { ProfileFact } from '@rovdo/shared';
import { emptyProfile, evaluateEligibility, expandSearch, rankJobs } from './index';

const job = (descriptionText: string) => JobSchema.parse({ id: 'fixture:1', source: 'greenhouse', tenant: 'fixture', sourceJobId: '1', requisitionId: null, canonicalUrl: 'https://jobs.example.com/1', company: 'Fixture', title: 'Engineer', location: 'Remote', workMode: 'remote', level: 'junior', descriptionText, postedAt: null, updatedAt: null, firstSeenAt: 1, lastSeenAt: 1, activeStatus: 'open', salary: null, contentSha256: 'a'.repeat(64), rawSha256: 'b'.repeat(64), parserVersion: 'ats-v1', duplicateGroup: null, provenance: [] });
const fact = (field: ProfileFact['field'], value: string): ProfileFact => ({ id: field, field, value, verified: true, source: { kind: 'user', reference: 'Explicit fixture assertion', capturedAt: '2026-10-16T00:00:00.000Z' } });
describe('eligibility gold cases v1', () => {
  it.each([
    ['Work authorization: US required.', 'workAuthorization', 'US', 'PASS'],
    ['Work authorization: US required.', 'workAuthorization', 'no', 'FAIL'],
    ['Work authorization: US required.', 'workAuthorization', 'CA', 'UNKNOWN'],
    ['Degree: Bachelor required.', 'degree', 'Master', 'PASS'],
    ['Degree: Bachelor required.', 'degree', 'Associate', 'FAIL'],
    ['Graduation year: 2027 required.', 'graduationYear', '2027', 'PASS'],
    ['Graduation year: 2027 required.', 'graduationYear', '2028', 'FAIL'],
    ['Return to school required.', 'returnToSchool', 'yes', 'PASS'],
    ['Return to school required.', 'returnToSchool', 'no', 'FAIL'],
    ['Active clearance required.', 'clearance', 'active', 'PASS'],
    ['Active clearance required.', 'clearance', 'none', 'FAIL'],
  ] as const)('%s with %s=%s gives %s', (text, field, value, expected) => {
    const checks = evaluateEligibility(job(text), { ...emptyProfile(), facts: [fact(field, value)] });
    expect(checks.find((c) => c.rule === field)?.result).toBe(expected); expect(checks.find((c) => c.rule === field)?.excerpt).toBe(text.slice(0, -1));
  });
  it('flags unpublished or unsupported requirements rather than certifying eligibility', () => {
    expect(evaluateEligibility(job('A great place to work'), emptyProfile()).some((c) => c.result === 'UNKNOWN')).toBe(true);
    expect(evaluateEligibility(job('Degree: Bachelor required. Visa sponsorship is not offered.'), { ...emptyProfile(), facts: [fact('degree', 'Bachelor')] }).some((c) => c.rule === 'sponsorship-review' && c.result === 'UNKNOWN')).toBe(true);
  });
  it('uses calibrated features and raw BM25 ordering without substring skill matches', () => {
    const profile = { ...emptyProfile(), facts: [fact('skill', 'Go')] };
    const matches = rankJobs([{ job: job('An ongoing project'), bm25Raw: -0.01 }, { job: { ...job('Go software'), id: 'fixture:2' }, bm25Raw: -1 }], profile);
    expect(matches[0]!.job.id).toBe('fixture:2'); expect(matches[1]!.matchedSkills).toEqual([]);
    expect(matches.every((m) => m.score >= 0 && m.score <= 100)).toBe(true);
    expect(expandSearch('software developer JS')).toContain('engineer'); expect(expandSearch('software developer JS')).toContain('javascript');
  });
});
