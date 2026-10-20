/** Synthetic verified candidate/job builders for deterministic ranking tests; no real applicant records. */
import { JobSchema, IntelligenceSchema } from '@rovdo/shared';
import type { CandidateProfile } from '@rovdo/shared';
import { emptyProfile } from '@rovdo/career';
export const AS_OF = '2026-10-17';
export const sampleJob = (
  descriptionText = 'Required Qualifications\nTypeScript and Node.js required\n4 years of backend experience\nBachelor degree required\nPreferred Qualifications\nPostgreSQL preferred',
) =>
  JobSchema.parse({
    id: 'fixture:1',
    source: 'greenhouse',
    tenant: 'fixture',
    sourceJobId: '1',
    requisitionId: null,
    canonicalUrl: 'https://jobs.example.com/1',
    company: 'Fixture',
    title: 'Backend Engineer',
    location: 'Remote',
    workMode: 'remote',
    level: 'mid',
    descriptionText,
    postedAt: null,
    updatedAt: null,
    firstSeenAt: 1,
    lastSeenAt: 1,
    activeStatus: 'open',
    salary: null,
    contentSha256: 'a'.repeat(64),
    rawSha256: 'b'.repeat(64),
    parserVersion: 'ats-v1',
    duplicateGroup: null,
    provenance: [],
  });
export function sampleCandidate(skills = ['typescript', 'nodejs', 'postgresql']): CandidateProfile {
  const evidence = {
    id: 'assertion',
    sourceId: 'user:fixture',
    sourceKind: 'user',
    excerpt: 'Verified project and employment assertion',
    sha256: 'a'.repeat(64),
    confidence: 1,
    verified: true,
  };
  const bound = { evidenceIds: ['assertion'], verified: true };
  return {
    ...emptyProfile(),
    intelligence: IntelligenceSchema.parse({
      schemaVersion: 'intelligence-v2',
      evidence: [evidence],
      skills: skills.map((skillId) => ({
        ...bound,
        id: skillId,
        skillId,
        version: null,
        depth: 'production',
      })),
      experience: [
        {
          ...bound,
          id: 'work',
          title: 'Backend Engineer',
          organization: 'Fixture',
          roleFamily: 'software',
          level: 'mid',
          track: 'ic',
          start: '2022-01',
          end: '2025-12',
          skills,
          production: true,
        },
      ],
      education: [
        {
          ...bound,
          id: 'degree',
          level: 'bachelor',
          field: 'Computer Science',
          institution: 'Fixture',
          status: 'completed',
          graduation: '2021',
        },
      ],
      projects: [
        {
          ...bound,
          id: 'project',
          name: 'Backend service',
          description: 'A verified backend project',
          roleFamily: 'software',
          skills,
          start: '2024-01',
          end: '2025-12',
          production: true,
          url: null,
        },
      ],
      certifications: [],
    }),
  };
}
