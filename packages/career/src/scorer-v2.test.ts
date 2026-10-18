import { describe, expect, it } from 'vitest';
import { BUILTIN_RANKINGS, rankWithProfile } from './scorer-v2';
import { rankJobs } from './index';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
const balanced = () => structuredClone(BUILTIN_RANKINGS.find((p) => p.id === 'builtin:technical-balanced')!);
const score = (candidate = sampleCandidate(), job = sampleJob()) => rankWithProfile([{ job, bm25Raw: -1 }], candidate, balanced(), AS_OF)[0]!;
describe('versioned requirement-centric ranking', () => {
  it('preserves immutable legacy weights and byte-equivalent legacy score behavior', () => {
    const legacy = BUILTIN_RANKINGS.find((p) => p.id === 'builtin:legacy-v1')!;
    expect(legacy.weights.skills).toBe(35); expect(legacy.weights.role).toBe(20);
    expect(() => { legacy.weights.skills = 0; }).toThrow();
    const candidate = sampleCandidate(); const rows = [{ job: sampleJob(), bm25Raw: -1 }];
    expect(rankWithProfile(rows, candidate, legacy, AS_OF)[0]!.score).toBe(rankJobs(rows, candidate)[0]!.score);
  });
  it('is deterministic, order-invariant, monotone and unaffected by unrelated candidate skills', () => {
    const candidate = sampleCandidate(); const a = score(candidate);
    expect(score(candidate)).toEqual(a);
    candidate.intelligence!.skills.reverse(); expect(score(candidate)).toEqual(a);
    const extra = sampleCandidate(['typescript', 'nodejs', 'postgresql', 'java', 'aws']);
    expect(score(extra).score).toBe(a.score);
    expect(score(sampleCandidate(['typescript'])).score).toBeLessThan(a.score);
    expect(a.ranking!.requiredCoverage).toBe(1);
  });
  it('keeps missing candidate evidence active but absent job criteria inactive', () => {
    const sparse = score(sampleCandidate([]), sampleJob('Required skills: TypeScript'));
    expect(sparse.ranking!.components.find((c) => c.name === 'skills')!.value).toBe(0);
    expect(sparse.ranking!.components.find((c) => c.name === 'education')!.value).toBeNull();
    expect(sparse.confidence).toBeLessThan(.5);
  });
  it('uses scoped duration, degree completion and graduation evidence without false failures', () => {
    const result = score(sampleCandidate(), sampleJob('Required Qualifications\nTypeScript required\n5 years of backend experience\nBachelor degree required'));
    expect(result.ranking!.components.find((c) => c.name === 'experience')!.value).toBe(.8);
    const candidate = sampleCandidate(); candidate.intelligence!.education[0]!.status = 'expected';
    expect(score(candidate).checks.find((c) => c.rule === 'education')!.result).toBe('UNKNOWN');
    expect(score(candidate).excluded).toBe(false);
  });
  it('keeps logistics and protected characteristics outside technical qualification', () => {
    const candidate = sampleCandidate(); const original = score(candidate);
    candidate.facts.push({ id: 'name', field: 'name', value: 'Different Name', verified: true, source: { kind: 'user', reference: 'Assertion', capturedAt: '2026-10-17T00:00:00.000Z' } });
    candidate.preferences.minimumSalary = 200000;
    expect(score(candidate).score).toBe(original.score);
    expect(score(candidate, { ...sampleJob(), location: 'Elsewhere', workMode: 'onsite' }).score).toBe(original.score);
  });
  it('cannot let lenient scoring override explicit authorization incompatibility', () => {
    const candidate = sampleCandidate(); candidate.facts.push({ id: 'legal', field: 'workAuthorization', value: 'no', verified: true, source: { kind: 'user', reference: 'Explicit assertion', capturedAt: '2026-10-17T00:00:00.000Z' } });
    const result = rankWithProfile([{ job: sampleJob('Required: TypeScript\nWork authorization: US required.'), bm25Raw: 0 }], candidate, BUILTIN_RANKINGS.find((p) => p.id === 'builtin:technical-lenient')!, AS_OF)[0]!;
    expect(result.excluded).toBe(true);
  });
  it('does not count explicitly frontend work as backend duration or a future legacy graduation as a completed degree', () => {
    const candidate = sampleCandidate(); candidate.intelligence!.experience[0]!.title = 'Frontend Engineer';
    expect(score(candidate).ranking!.components.find((c) => c.name === 'experience')!.value).toBe(0);
    delete candidate.intelligence;
    candidate.facts = [{ id: 'degree', field: 'degree', value: 'Bachelor', verified: true, source: { kind: 'user', reference: 'Assertion', capturedAt: '2026-10-17T00:00:00.000Z' } }, { id: 'grad', field: 'graduationYear', value: '2027', verified: true, source: { kind: 'user', reference: 'Assertion', capturedAt: '2026-10-17T00:00:00.000Z' } }];
    expect(score(candidate).checks.find((c) => c.rule === 'education')?.result).toBe('UNKNOWN');
  });
  it('leaves incomplete dates and work modality unknown and does not accept future completed education', () => {
    const candidate = sampleCandidate(); candidate.intelligence!.experience[0]!.start = null;
    candidate.intelligence!.education[0]!.graduation = '2026-12'; candidate.preferences.workModes = ['remote'];
    const config = balanced(); config.gates.experience = true;
    const result = rankWithProfile([{ job: { ...sampleJob(), location: 'London', workMode: 'unknown' }, bm25Raw: 0 }], candidate, config, AS_OF)[0]!;
    expect(result.checks.find((c) => c.rule === 'experience')!.result).toBe('UNKNOWN');
    expect(result.checks.find((c) => c.rule === 'location')!.result).toBe('UNKNOWN');
    expect(result.checks.find((c) => c.rule === 'education')!.result).toBe('UNKNOWN');
  });
  it('does not report coverage for an unproved technology version or unrelated degree field', () => {
    const candidate = sampleCandidate(['react']);
    const result = score(candidate, sampleJob('Required: React >=18\nBachelor in Electrical Engineering required'));
    expect(result.ranking!.requiredCoverage).toBe(0);
    expect(result.gaps).toContain('react');
    expect(result.checks.find((c) => c.rule === 'education')!.result).toBe('FAIL');
  });
});
