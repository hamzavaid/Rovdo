/**
 * Approved application snapshot schema, stable hashing and asynchronous integrity validation.
 * Structural parsing alone cannot verify digests; hashes detect modification but are not approval signatures.
 */
import { z } from 'zod';
import { JobSchema, ProfileFactSchema } from './career';
import { IntelligenceSchema, RankingProfileSchema, RequirementSetSchema } from './intelligence';
import { qualificationSupport } from './evidence';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(250);
const ApprovedFactSchema = z.strictObject({
  ...ProfileFactSchema.shape,
  verified: z.literal(true),
  evidenceIds: z.array(id).min(1).max(50),
});
export const ApprovedApplicationContextSchema = z
  .strictObject({
    contractVersion: z.literal('approved-application-v1'),
    job: JobSchema,
    candidate: z.strictObject({
      facts: z.array(ApprovedFactSchema).max(500),
      qualifications: IntelligenceSchema,
    }),
    requirements: RequirementSetSchema,
    ranking: RankingProfileSchema,
    template: z.strictObject({ id, version: z.string().min(1).max(100), contentSha256: hash }),
    approval: z.strictObject({
      approvedAt: z.iso.datetime(),
      factIds: z.array(id).max(500),
      qualificationIds: z.array(id).max(1000),
    }),
    claims: z
      .array(
        z.strictObject({
          subject: id,
          evidenceIds: z.array(id).min(1).max(50),
          contentSha256: hash,
        }),
      )
      .max(1500),
    omitted: z
      .array(
        z.strictObject({
          id,
          reason: z.enum(['unverified', 'unsupported', 'conflicting', 'sensitive']),
        }),
      )
      .max(1500),
    versions: z.strictObject({
      profileVersion: z.number().int().positive(),
      scorerPolicy: id,
      candidatePolicy: id,
      evidencePolicy: id,
      taxonomyVersion: id,
      requirementsParserVersion: id,
    }),
    hashes: z.strictObject({
      job: hash,
      candidate: hash,
      requirements: hash,
      ranking: hash,
      template: hash,
      context: hash,
    }),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.candidate.facts.map((f) => f.id)).size !== v.candidate.facts.length ||
      new Set(v.approval.factIds).size !== v.approval.factIds.length ||
      new Set(v.approval.qualificationIds).size !== v.approval.qualificationIds.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate fact or approval IDs' });
    const intel = v.candidate.qualifications;
    const evidence = new Map(intel.evidence.map((e) => [e.id, e]));
    const subjects = new Map<string, string[]>();
    for (const fact of v.candidate.facts) {
      if (
        ['citizenship', 'workAuthorization', 'clearance'].includes(fact.field) ||
        !v.approval.factIds.includes(fact.id) ||
        !fact.evidenceIds.every((id) => {
          const e = evidence.get(id);
          return (
            e?.verified &&
            e.stance !== 'contradicts' &&
            e.confidence * (e.sourceReliability ?? 1) > 0
          );
        })
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Fact needs explicit approval and verified evidence',
        });
      subjects.set(`fact:${fact.id}`, fact.evidenceIds);
    }
    for (const key of ['skills', 'experience', 'education', 'projects', 'certifications'] as const)
      for (const q of intel[key]) {
        const subject = `${key}:${q.id}`;
        const support = qualificationSupport(q, evidence);
        if (
          !v.approval.qualificationIds.includes(subject) ||
          !q.verified ||
          support.confidence <= 0 ||
          support.confidence < v.ranking.minimumEvidence ||
          support.conflict
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Qualification is unapproved, unsupported or conflicting',
          });
        subjects.set(subject, q.evidenceIds);
      }
    if (
      new Set(v.claims.map((c) => c.subject)).size !== v.claims.length ||
      subjects.size !== v.claims.length
    )
      ctx.addIssue({ code: 'custom', message: 'Each approved subject needs one claim binding' });
    for (const claim of v.claims) {
      const refs = subjects.get(claim.subject);
      if (
        !refs ||
        refs.length !== claim.evidenceIds.length ||
        claim.evidenceIds.some((id) => !refs.includes(id) || !evidence.get(id)?.verified)
      )
        ctx.addIssue({ code: 'custom', message: 'Claim has dangling or unrelated evidence' });
    }
    if (
      v.requirements.taxonomyVersion !== v.versions.taxonomyVersion ||
      v.requirements.parserVersion !== v.versions.requirementsParserVersion
    )
      ctx.addIssue({ code: 'custom', message: 'Requirement versions do not match' });
  });
export type ApprovedApplicationContext = z.infer<typeof ApprovedApplicationContextSchema>;
/** Stable serialization for content integrity; hashes are not authorization signatures. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export async function sha256Text(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
export const contentHash = (value: unknown) => sha256Text(canonicalJson(value));
/** Validate source, claim, part and whole-snapshot digests after structural schema checks. */
export async function validateApprovedApplicationContext(
  input: unknown,
): Promise<ApprovedApplicationContext> {
  const context = ApprovedApplicationContextSchema.parse(input);
  const intel = context.candidate.qualifications;
  for (const e of intel.evidence)
    if (e.sha256 !== (await sha256Text(e.excerpt))) throw new Error('EVIDENCE_HASH_MISMATCH');
  for (const claim of context.claims) {
    const [section, ...ids] = claim.subject.split(':');
    const id = ids.join(':');
    const value =
      section === 'fact'
        ? context.candidate.facts.find((f) => f.id === id)
        : intel[section as 'skills'].find((q) => q.id === id);
    if (!value || claim.contentSha256 !== (await contentHash(value)))
      throw new Error('CLAIM_HASH_MISMATCH');
  }
  for (const key of ['job', 'candidate', 'requirements', 'ranking', 'template'] as const)
    if (context.hashes[key] !== (await contentHash(context[key])))
      throw new Error('CONTENT_HASH_MISMATCH');
  const { hashes, ...body } = context;
  const { context: contextHash, ...parts } = hashes;
  if (contextHash !== (await contentHash({ ...body, hashes: parts })))
    throw new Error('CONTEXT_HASH_MISMATCH');
  return context;
}
