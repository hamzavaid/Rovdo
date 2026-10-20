import { expect, it } from 'vitest';
import { updateQualification, confirmQualification } from './profile-edit';
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
