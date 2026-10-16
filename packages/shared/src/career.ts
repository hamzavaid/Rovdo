import { z } from 'zod';
const bounded = z.string().trim().min(1).max(4000);
export const ProvenanceSchema = z.strictObject({ kind: z.enum(['user', 'document']), reference: bounded, capturedAt: z.iso.datetime() });
export const ProfileFactSchema = z.strictObject({ id: z.string().min(1).max(200), field: z.enum(['name', 'email', 'phone', 'education', 'experience', 'project', 'skill', 'link', 'citizenship', 'workAuthorization', 'degree', 'graduationYear', 'returnToSchool', 'clearance']), value: bounded, verified: z.boolean(), source: ProvenanceSchema }).refine((v) => !['citizenship', 'workAuthorization'].includes(v.field) || v.source.kind === 'user');
export const PreferencesSchema = z.strictObject({
  roles: z.array(bounded).max(30), excludedRoles: z.array(bounded).max(30), locations: z.array(bounded).max(30), workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).max(3), levels: z.array(z.enum(['internship', 'new-grad', 'junior', 'mid', 'senior'])).max(5), minimumSalary: z.number().finite().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/),
  weights: z.strictObject({ skills: z.number().min(0).max(1), role: z.number().min(0).max(1), location: z.number().min(0).max(1), eligibility: z.number().min(0).max(1), preferences: z.number().min(0).max(1) }).refine((v) => Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 1) < 1e-9),
});
export const CandidateProfileSchema = z.strictObject({ version: z.number().int().positive(), facts: z.array(ProfileFactSchema).max(500), preferences: PreferencesSchema }).refine((v) => new Set(v.facts.map((f) => f.id)).size === v.facts.length);
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type ProfileFact = z.infer<typeof ProfileFactSchema>;
export const SourceConfigSchema = z.strictObject({
  id: z.uuid(), ats: z.enum(['greenhouse', 'lever', 'ashby']), tenant: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), company: z.string().trim().min(1).max(200), enabled: z.boolean(), region: z.enum(['global', 'eu']), intervalMs: z.number().int().min(60000).max(2592000000), termsReviewedAt: z.iso.datetime(), timezone: z.string().max(80).refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }), priority: z.number().int().min(0).max(100), missingGracePolls: z.number().int().min(2).max(30),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export const SourceStateSchema = z.strictObject({
  status: z.enum(['NEVER_POLLED', 'POLLING', 'OK', 'EMPTY_SOURCE', 'FAILED_SOURCE', 'DISABLED', 'INTERRUPTED']), cursor: z.string().max(200).nullable(), pollId: z.string().nullable(), etag: z.string().max(1000).nullable(), lastModified: z.string().max(1000).nullable(), lastPollAt: z.number().nullable(), lastSuccessAt: z.number().nullable(), nextPollAt: z.number(), failures: z.number().int().nonnegative(), responseStatus: z.number().int().nullable(), returned: z.number().int().nonnegative(), parsed: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(), requests: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), error: z.string().max(80).nullable(), parserVersion: z.literal('ats-v1'),
});
export type SourceState = z.infer<typeof SourceStateSchema>;
export const SourceViewSchema = z.strictObject({ config: SourceConfigSchema, state: SourceStateSchema });
export type SourceView = z.infer<typeof SourceViewSchema>;
export const JobSchema = z.strictObject({
  id: z.string().min(1).max(300), source: SourceConfigSchema.shape.ats, tenant: z.string(), sourceJobId: z.string().max(200), requisitionId: z.string().max(200).nullable(), canonicalUrl: z.string().url().max(2048), company: z.string().min(1).max(200), title: z.string().min(1).max(500), location: z.string().max(500), workMode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']), level: z.enum(['internship', 'new-grad', 'junior', 'mid', 'senior', 'unknown']), descriptionText: z.string().max(100000), postedAt: z.string().nullable(), updatedAt: z.string().nullable(), firstSeenAt: z.number(), lastSeenAt: z.number(), activeStatus: z.enum(['open', 'closed', 'unknown']),
  salary: z.strictObject({ min: z.number().finite().nonnegative().nullable(), max: z.number().finite().nonnegative().nullable(), currency: z.string().max(10), interval: z.string().max(40), source: z.literal('explicit') }).nullable(), contentSha256: z.string().length(64), rawSha256: z.string().length(64), parserVersion: z.literal('ats-v1'), duplicateGroup: z.string().nullable(),
  provenance: z.array(z.strictObject({ sourceId: z.uuid(), sourceKey: z.string(), url: z.string().url(), collectedAt: z.number(), rawSha256: z.string().length(64), fields: z.record(z.string(), z.string()) })).max(100),
});
export type Job = z.infer<typeof JobSchema>;
export const EligibilityCheckSchema = z.strictObject({ rule: z.string(), result: z.enum(['PASS', 'FAIL', 'UNKNOWN']), excerpt: z.string(), factIds: z.array(z.string()) });
export type EligibilityCheck = z.infer<typeof EligibilityCheckSchema>;
export const JobMatchSchema = z.strictObject({ job: JobSchema, score: z.number().min(0).max(100), bm25Raw: z.number(), excluded: z.boolean(), review: z.boolean(), confidence: z.number().min(0).max(1), checks: z.array(EligibilityCheckSchema), matchedSkills: z.array(z.string()), gaps: z.array(z.string()), reasons: z.array(z.string()), profileVersion: z.number().int(), scorerVersion: z.literal('deterministic-v1'), features: z.record(z.string(), z.number()) });
export type JobMatch = z.infer<typeof JobMatchSchema>;
export const JobSearchSchema = z.strictObject({ query: z.string().max(500), company: z.string().max(200), workMode: z.enum(['all', 'remote', 'hybrid', 'onsite']), savedOnly: z.boolean(), includeExcluded: z.boolean(), offset: z.number().int().min(0).max(100000).optional() });
export type JobSearch = z.infer<typeof JobSearchSchema>;
export const AiReviewSchema = z.strictObject({ jobId: z.string(), contentHash: z.string().length(64), profileVersion: z.number().int(), model: z.string(), text: z.string().max(16000), estimatedUsd: z.number().nullable(), createdAt: z.number() });
export type AiReview = z.infer<typeof AiReviewSchema>;
export const CareerViewSchema = z.strictObject({ profile: CandidateProfileSchema.nullable(), sources: z.array(SourceViewSchema), matches: z.array(JobMatchSchema), savedIds: z.array(z.string()), reviews: z.array(AiReviewSchema), outcome: z.enum(['RESULTS', 'ZERO_MATCHES', 'EMPTY_SOURCE', 'FAILED_SOURCE', 'NOT_POLLED']), totalJobs: z.number().int(), matchedCount: z.number().int(), polling: z.boolean() });
export const CareerCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('view'), search: JobSearchSchema }), z.strictObject({ op: z.literal('saveProfile'), profile: CandidateProfileSchema }), z.strictObject({ op: z.literal('proposeFacts'), facts: z.array(ProfileFactSchema).max(100) }), z.strictObject({ op: z.literal('saveSource'), source: SourceConfigSchema }), z.strictObject({ op: z.literal('poll') }), z.strictObject({ op: z.literal('saveJob'), jobId: z.string().max(300), saved: z.boolean() }),
  z.strictObject({ op: z.literal('evaluate'), jobIds: z.array(z.string().max(300)).min(1).max(5), modelProfileId: z.uuid(), maxUsd: z.number().positive().max(10), consent: z.literal(true) }),
]);
export type CareerCommand = z.infer<typeof CareerCommandSchema>;
export const CareerResultSchema = z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), view: CareerViewSchema }), z.strictObject({ ok: z.literal(false), code: z.enum(['IPC_FORBIDDEN', 'VALIDATION_ERROR', 'CAREER_ERROR', 'AI_REVIEW_FAILED']) })]);
export const CAREER_CHANNEL = 'career:command';
export interface CareerApi { careerCommand(command: CareerCommand): Promise<z.infer<typeof CareerResultSchema>> }
