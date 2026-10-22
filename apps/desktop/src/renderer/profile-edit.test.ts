import { expect, it } from 'vitest';
import {
  updateQualification,
  confirmQualification,
  proposeQualification,
  newQualification,
} from './profile-edit';
import { sampleCandidate } from '../../../../tests/fixtures/ranking-v2';
import { IntelligenceSchema } from '@rovdo/shared';
it('invalidates edited qualifications and binds explicit re-verification to new user evidence', async () => {
  const original = sampleCandidate().intelligence!;
  const edited = updateQualification(original, 'skills', 'typescript', { version: '5' });
  expect(original.skills[0]!.version).toBeNull();
  expect(edited.skills[0]!.verified).toBe(false);
  const verified = await confirmQualification(edited, 'skills', 'typescript');
  expect(verified.skills[0]!.verified).toBe(true);
  expect(verified.evidence).toHaveLength(original.evidence.length + 1);
  expect(verified.evidence.at(-1)!.sourceKind).toBe('user');
  expect(verified.evidence.at(-1)!.excerpt).toContain('previousEvidenceIds');
  expect(IntelligenceSchema.safeParse(verified).success).toBe(true);
});

it('creates typed, evidence-backed proposals without overwriting an existing verified skill', async () => {
  const p = sampleCandidate();
  const original = p.intelligence!.skills[0]!;
  const next = await proposeQualification(
    p,
    'skills',
    { ...newQualification('skills'), skillId: 'TS', proficiency: 'beginner' },
    'User reference',
  );
  expect(next.intelligence!.skills).toHaveLength(p.intelligence!.skills.length);
  expect(next.intelligence!.skills[0]!.verified).toBe(true);
  expect(next.intelligence!.skills[0]!.proficiency).toBe(original.proficiency);
  const project = await proposeQualification(
    p,
    'projects',
    {
      ...newQualification('projects'),
      name: 'Firmware controller',
      description: 'Built a controller using C++',
      skills: ['C++'],
    },
    'My repository',
  );
  expect(project.intelligence!.projects.at(-1)).toMatchObject({
    name: 'Firmware controller',
    skills: ['cpp'],
    verified: false,
  });
  expect(IntelligenceSchema.safeParse(project.intelligence).success).toBe(true);
});
