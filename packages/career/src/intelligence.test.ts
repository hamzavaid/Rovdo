import { describe, expect, it } from 'vitest';
import { resolveSkill, matchSkill, roleOf, TAXONOMY_VERSION } from './taxonomy';
import { extractRequirements, degreeGate, unionMonths } from './requirements';
import { IntelligenceSchema } from '@rovdo/shared';

describe('canonical taxonomy v2', () => {
  it('keeps technical punctuation and ambiguous aliases typed', () => {
    expect(resolveSkill('C++')?.id).toBe('cpp'); expect(resolveSkill('C#')?.id).toBe('csharp');
    expect(resolveSkill('Node.js')?.id).toBe('nodejs'); expect(resolveSkill('ts')).toBeNull();
    expect(resolveSkill('ts', 'skill')?.id).toBe('typescript');
    expect(matchSkill('java', 'javascript').strength).toBe(0);
    expect(matchSkill('aws', 'azure').strength).toBe(0);
    expect(matchSkill('typescript', 'javascript').strength).toBeGreaterThan(0);
    expect(matchSkill('javascript', 'typescript').strength).toBe(0);
    expect(TAXONOMY_VERSION).toBe('rovdo-taxonomy-2');
  });
  it('does not equate incompatible versions or IC and management tracks', () => {
    expect(matchSkill('react', 'react', '17', '>=18').strength).toBe(0);
    expect(matchSkill('react', 'react', '18.2', '>=18').strength).toBe(1);
    expect(matchSkill('react', 'react', null, '>=18').strength).toBeLessThan(1);
    expect(roleOf('Staff Backend Engineer').track).toBe('ic');
    expect(roleOf('Engineering Manager').track).toBe('management');
    expect(roleOf('Senior Living Software Engineer').level).toBe('unknown');
  });
});
describe('requirement evidence and date rules', () => {
  it('preserves sections, excerpts, priority and parser confidence without inventing requirements', () => {
    const text = 'Minimum Qualifications\n- TypeScript and Node.js required\n- 3+ years of backend experience\nPreferred Qualifications\n- AWS or Azure\n- React >=18 preferred';
    const parsed = extractRequirements(text, 'Backend Engineer');
    expect(parsed.items.find((r) => r.skillId === 'typescript')?.importance).toBe('required');
    expect(parsed.items.some((r) => r.skillId === 'javascript')).toBe(false);
    expect(parsed.items.find((r) => r.skillId === 'aws')?.importance).toBe('preferred');
    expect(parsed.items.find((r) => r.kind === 'experience')?.months).toBe(36);
    expect(parsed.items.every((r) => text.slice(r.start, r.end) === r.excerpt)).toBe(true);
    expect(parsed.items.find((r) => r.skillId === 'react')?.versionRange).toBe('>=18');
    expect(extractRequirements('Our company uses Go to market strategies.', 'Sales').items.filter((r) => r.kind === 'skill')).toHaveLength(0);
  });
  it('counts explicit alternatives once without relaxing separate skills on the same line', () => {
    const parsed = extractRequirements('Required skills: TypeScript and AWS or Azure', 'Backend Engineer');
    const skills = parsed.items.filter((r) => r.kind === 'skill');
    expect(skills).toHaveLength(2);
    expect(skills.find((r) => r.skillId === 'typescript')!.alternatives).toEqual([]);
    expect(skills.find((r) => r.skillId === 'aws')!.alternatives).toEqual(['azure']);
  });
  it('treats degree alternatives, enrollment and expected graduation separately', () => {
    expect(degreeGate({ level: 'bachelor', status: 'expected', graduation: '2027' }, { level: 'bachelor', enrollmentAllowed: false, equivalentAllowed: false })).toBe('UNKNOWN');
    expect(degreeGate({ level: 'master', status: 'completed', graduation: '2025' }, { level: 'bachelor', enrollmentAllowed: false, equivalentAllowed: false })).toBe('PASS');
    expect(degreeGate({ level: 'associate', status: 'completed', graduation: '2025' }, { level: 'bachelor', enrollmentAllowed: false, equivalentAllowed: true })).toBe('UNKNOWN');
    expect(degreeGate({ level: 'bachelor', status: 'enrolled', graduation: '2027' }, { level: 'bachelor', enrollmentAllowed: true, equivalentAllowed: false })).toBe('PASS');
  });
  it('unions concurrent employment, handles current dates explicitly and rejects invalid chronology', () => {
    expect(unionMonths([{ start: '2020-01', end: '2020-12' }, { start: '2020-06', end: '2021-05' }], '2022-01-01')).toBe(17);
    expect(unionMonths([{ start: '2025-01', end: null }], '2026-01-01')).toBe(12);
    expect(unionMonths([{ start: '2028-01', end: '2020-01' }], '2026-01-01')).toBe(0);
  });
  it('validates versioned evidence and rejects unbound evidence references', () => {
    expect(IntelligenceSchema.safeParse({ schemaVersion: 'intelligence-v2', evidence: [], skills: [{ id: 's', skillId: 'typescript', version: null, evidenceIds: ['missing'], verified: true, depth: 'declared' }], education: [], experience: [], projects: [], certifications: [] }).success).toBe(false);
  });
});
