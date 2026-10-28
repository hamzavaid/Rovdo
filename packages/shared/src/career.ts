import { DiscoveryOptionsSchema, DiscoveryViewSchema, JobSpySettingsSchema } from './discovery';
/**
 * Candidate, employer, source, job and search/management IPC contracts.
 * Legacy facts remain readable alongside structured intelligence and provenance-bearing normalized jobs.
 */
import { z } from 'zod';
import {
  IntelligenceSchema,
  RankingDetailsSchema,
  RequirementSetSchema,
  RankingProfileSchema,
} from './intelligence';
const bounded = z.string().trim().min(1).max(4000);
export const ProvenanceSchema = z.strictObject({
  kind: z.enum(['user', 'document']),
  reference: bounded,
  capturedAt: z.iso.datetime(),
});
export const ProfileFactSchema = z
  .strictObject({
    id: z.string().min(1).max(200),
    field: z.enum([
      'name',
      'email',
      'phone',
      'education',
      'experience',
      'project',
      'skill',
      'link',
      'citizenship',
      'workAuthorization',
      'degree',
      'graduationYear',
      'returnToSchool',
      'clearance',
    ]),
    value: bounded,
    verified: z.boolean(),
    source: ProvenanceSchema,
  })
  .refine(
    (v) => !['citizenship', 'workAuthorization'].includes(v.field) || v.source.kind === 'user',
  );
export const PreferencesSchema = z.strictObject({
  roles: z.array(bounded).max(30),
  excludedRoles: z.array(bounded).max(30),
  locations: z.array(bounded).max(30),
  workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).max(3),
  levels: z.array(z.enum(['internship', 'new-grad', 'junior', 'mid', 'senior'])).max(5),
  minimumSalary: z.number().finite().nonnegative().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  preferredCompanies: z.array(bounded).max(30).optional(),
  excludedCompanies: z.array(bounded).max(30).optional(),
  weights: z
    .strictObject({
      skills: z.number().min(0).max(1),
      role: z.number().min(0).max(1),
      location: z.number().min(0).max(1),
      eligibility: z.number().min(0).max(1),
      preferences: z.number().min(0).max(1),
    })
    .refine((v) => Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 1) < 1e-9),
});
export const CandidateProfileSchema = z
  .strictObject({
    version: z.number().int().positive(),
    facts: z.array(ProfileFactSchema).max(500),
    preferences: PreferencesSchema,
    intelligence: IntelligenceSchema.optional(),
  })
  .refine((v) => new Set(v.facts.map((f) => f.id)).size === v.facts.length);
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type ProfileFact = z.infer<typeof ProfileFactSchema>;
export const AtsKindSchema = z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jsonld']);
export const EmployerSchema = z.strictObject({
  id: z.string().max(200),
  company: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)).max(20),
  ats: AtsKindSchema,
  tenant: z.string().max(120),
  region: z.enum(['global', 'eu']),
  reference: z.string().url().max(2048),
  policyReference: z.string().url().max(2048),
  policy: z.enum(['approved', 'review', 'blocked']),
  verifiedAt: z.iso.datetime(),
  refreshAfter: z.iso.datetime(),
  responseHash: z.string().length(64),
  pageUrl: z.string().url().max(2048).optional(),
});
export type Employer = z.infer<typeof EmployerSchema>;
export const SourceConfigSchema = z.strictObject({
  id: z.uuid(),
  ats: AtsKindSchema,
  tenant: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  company: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  region: z.enum(['global', 'eu']),
  intervalMs: z.number().int().min(60000).max(2592000000),
  termsReviewedAt: z.iso.datetime(),
  timezone: z
    .string()
    .max(80)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
  priority: z.number().int().min(0).max(100),
  missingGracePolls: z.number().int().min(2).max(30),
  directoryId: z.string().max(200).optional(),
  companyId: z.string().max(200).optional(),
  pageUrl: z.string().url().max(2048).optional(),
  collection: z.enum(['saved', 'global']).optional(),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export const SourceStateSchema = z.strictObject({
  status: z.enum([
    'NEVER_POLLED',
    'POLLING',
    'OK',
    'EMPTY_SOURCE',
    'FAILED_SOURCE',
    'DISABLED',
    'INTERRUPTED',
  ]),
  cursor: z.string().max(200).nullable(),
  pollId: z.string().nullable(),
  etag: z.string().max(1000).nullable(),
  lastModified: z.string().max(1000).nullable(),
  lastPollAt: z.number().nullable(),
  lastSuccessAt: z.number().nullable(),
  nextPollAt: z.number(),
  failures: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  returned: z.number().int().nonnegative(),
  parsed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  error: z.string().max(80).nullable(),
  parserVersion: z.literal('ats-v1'),
});
export type SourceState = z.infer<typeof SourceStateSchema>;
export const SourceViewSchema = z.strictObject({
  config: SourceConfigSchema,
  state: SourceStateSchema,
});
export type SourceView = z.infer<typeof SourceViewSchema>;
export const JobSchema = z.strictObject({
  id: z.string().min(1).max(300),
  source: z.enum([
    'greenhouse',
    'lever',
    'ashby',
    'smartrecruiters',
    'jsonld',
    'public-api',
    'github-list',
    'search-index',
    'jobspy',
  ]),
  discovery: z
    .strictObject({
      kind: z.enum(['employer', 'aggregate', 'repository', 'index', 'import']),
      availability: z.enum(['verified', 'unverified', 'closed']),
      sourceName: z.string().max(200),
      sourceUrl: z.string().url(),
      attributionUrl: z.string().url(),
      checkedAt: z.number(),
      runId: z.uuid(),
      exportAllowed: z.boolean(),
    })
    .optional(),
  tenant: z.string(),
  sourceJobId: z.string().max(200),
  requisitionId: z.string().max(200).nullable(),
  canonicalUrl: z.string().url().max(2048),
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  location: z.string().max(500),
  workMode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  level: z.enum(['internship', 'new-grad', 'junior', 'mid', 'senior', 'unknown']),
  descriptionText: z.string().max(100000),
  postedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  activeStatus: z.enum(['open', 'closed', 'unknown']),
  details: z
    .strictObject({
      employmentType: z.enum([
        'full-time',
        'part-time',
        'contract',
        'temporary',
        'internship',
        'unknown',
      ]),
      roleFamily: z.string(),
      remoteJurisdiction: z.array(z.string().max(300)).max(20),
      season: z.enum(['spring', 'summer', 'fall', 'winter', 'unknown']),
      country: z.string().max(100),
      requirements: RequirementSetSchema,
    })
    .optional(),
  salary: z
    .strictObject({
      min: z.number().finite().nonnegative().nullable(),
      max: z.number().finite().nonnegative().nullable(),
      currency: z.string().max(10),
      interval: z.string().max(40),
      source: z.literal('explicit'),
    })
    .nullable(),
  contentSha256: z.string().length(64),
  rawSha256: z.string().length(64),
  parserVersion: z.literal('ats-v1'),
  duplicateGroup: z.string().nullable(),
  provenance: z.array(
    z.strictObject({
      sourceId: z.uuid(),
      sourceKey: z.string(),
      url: z.string().url(),
      collectedAt: z.number(),
      rawSha256: z.string().length(64),
      fields: z.record(z.string(), z.string()),
    }),
  ),
});
export type Job = z.infer<typeof JobSchema>;
export const EligibilityCheckSchema = z.strictObject({
  rule: z.string(),
  result: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
  excerpt: z.string(),
  factIds: z.array(z.string()),
});
export type EligibilityCheck = z.infer<typeof EligibilityCheckSchema>;
export const JobMatchSchema = z.strictObject({
  job: JobSchema,
  score: z.number().min(0).max(100),
  bm25Raw: z.number(),
  excluded: z.boolean(),
  review: z.boolean(),
  confidence: z.number().min(0).max(1),
  checks: z.array(EligibilityCheckSchema),
  matchedSkills: z.array(z.string()),
  gaps: z.array(z.string()),
  reasons: z.array(z.string()),
  profileVersion: z.number().int(),
  scorerVersion: z.enum([
    'deterministic-v1',
    'deterministic-v2',
    'deterministic-v2.1',
    'deterministic-v2.2',
  ]),
  features: z.record(z.string(), z.number()),
  ranking: RankingDetailsSchema.optional(),
});
export type JobMatch = z.infer<typeof JobMatchSchema>;
export const JobSearchSchema = z.strictObject({
  scope: z.enum(['global', 'saved-companies', 'company']).optional(),
  selectedSourceId: z.uuid().optional(),
  discovery: DiscoveryOptionsSchema.optional(),
  employmentType: z.string().max(40).optional(),
  sourceId: z.string().max(200).optional(),
  availability: z.enum(['all', 'verified', 'unverified']).optional(),
  sort: z.enum(['qualification', 'newest', 'salary', 'company']).optional(),
  query: z.string().max(500),
  company: z.string().max(200),
  workMode: z.enum(['all', 'remote', 'hybrid', 'onsite']),
  savedOnly: z.boolean(),
  includeExcluded: z.boolean(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  roleFamily: z.string().max(100).optional(),
  season: z.enum(['all', 'spring', 'summer', 'fall', 'winter']).optional(),
  graduationYear: z.number().int().min(2000).max(2100).optional(),
  experienceLevel: z
    .enum(['all', 'internship', 'new-grad', 'junior', 'mid', 'senior', 'unknown'])
    .optional(),
  location: z.string().max(200).optional(),
  minimumSalary: z.number().nonnegative().optional(),
  salaryCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  freshnessDays: z.number().int().min(1).max(3650).optional(),
  minimumScore: z.number().min(0).max(100).optional(),
  eligibility: z.enum(['all', 'pass', 'review', 'fail']).optional(),
  hideApplied: z.boolean().optional(),
  newOnly: z.boolean().optional(),
  feedback: z.enum(['all', 'relevant', 'irrelevant']).optional(),
  rankingId: z.string().max(200).optional(),
});
export type JobSearch = z.infer<typeof JobSearchSchema>;
export const AiReviewSchema = z.strictObject({
  jobId: z.string(),
  contentHash: z.string().length(64),
  profileVersion: z.number().int(),
  model: z.string(),
  text: z.string().max(16000),
  estimatedUsd: z.number().nullable(),
  createdAt: z.number(),
});
export type AiReview = z.infer<typeof AiReviewSchema>;
export const SavedSearchSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  search: JobSearchSchema,
});
export const JobMarkerSchema = z.strictObject({
  jobId: z.string().max(300),
  feedback: z.enum(['none', 'relevant', 'irrelevant']),
  applied: z.boolean(),
  seenAt: z.number().nonnegative(),
});
export type JobMarker = z.infer<typeof JobMarkerSchema>;
export type SavedSearch = z.infer<typeof SavedSearchSchema>;
export const CareerViewSchema = z.strictObject({
  jobspy: JobSpySettingsSchema.optional(),
  profile: CandidateProfileSchema.nullable(),
  sources: z.array(SourceViewSchema),
  matches: z.array(JobMatchSchema),
  savedIds: z.array(z.string()),
  reviews: z.array(AiReviewSchema),
  outcome: z.enum(['RESULTS', 'ZERO_MATCHES', 'EMPTY_SOURCE', 'FAILED_SOURCE', 'NOT_POLLED']),
  totalJobs: z.number().int(),
  matchedCount: z.number().int(),
  rankingPending: z.number().int().nonnegative().optional(),
  polling: z.boolean(),
  discovery: DiscoveryViewSchema.optional(),
  directory: z.array(EmployerSchema).default([]),
  savedSearches: z.array(SavedSearchSchema).default([]),
  markers: z.array(JobMarkerSchema).default([]),
  comparisons: z.array(JobMatchSchema).default([]),
  rankingProfiles: z.array(RankingProfileSchema).default([]),
  cache: z.object({ hits: z.number(), misses: z.number() }).optional(),
});
export const CareerCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('jobspySettings'), settings: JobSpySettingsSchema }),
  z.strictObject({
    op: z.literal('view'),
    search: JobSearchSchema,
    summary: z.boolean().optional(),
  }),
  z.strictObject({ op: z.literal('saveProfile'), profile: CandidateProfileSchema }),
  z.strictObject({ op: z.literal('proposeFacts'), facts: z.array(ProfileFactSchema).max(100) }),
  z.strictObject({ op: z.literal('saveSource'), source: SourceConfigSchema }),
  z.strictObject({ op: z.literal('poll') }),
  z.strictObject({ op: z.literal('saveJob'), jobId: z.string().max(300), saved: z.boolean() }),
  z.strictObject({ op: z.literal('deleteSource'), id: z.uuid() }),
  // Legacy clients retain saved-directory behavior; the new global scope is explicit.
  z.strictObject({ op: z.literal('searchAll') }),
  z.strictObject({ op: z.literal('searchSavedCompanies') }),
  z.strictObject({ op: z.literal('pollCompany'), id: z.uuid() }),
  z.strictObject({
    op: z.literal('startDiscovery'),
    options: DiscoveryOptionsSchema,
    consent: z.literal(true),
  }),
  z.strictObject({
    op: z.literal('controlDiscovery'),
    id: z.uuid(),
    action: z.enum(['pause', 'resume', 'cancel']),
  }),
  z.strictObject({
    op: z.literal('importDiscovery'),
    runId: z.uuid().optional(),
    rows: z.array(z.record(z.string(), z.unknown())).max(100),
    permitted: z.literal(true),
  }),

  z.strictObject({
    op: z.literal('discoverFeeds'),
    url: z.string().url().max(2048),
    company: z.string().trim().min(1).max(200),
    policyUrl: z.string().url().max(2048),
    permitted: z.literal(true),
  }),
  z.strictObject({
    op: z.literal('saveSearch'),
    name: z.string().trim().min(1).max(100),
    search: JobSearchSchema,
  }),
  z.strictObject({ op: z.literal('openJob'), jobId: z.string().min(1).max(300) }),
  z.strictObject({ op: z.literal('deleteSearch'), id: z.uuid() }),
  z.strictObject({
    op: z.literal('exportJobs'),
    format: z.enum(['csv', 'json']),
    search: JobSearchSchema,
  }),
  z.strictObject({
    op: z.literal('markJob'),
    jobId: z.string().max(300),
    feedback: z.enum(['none', 'relevant', 'irrelevant']).optional(),
    applied: z.boolean().optional(),
    seen: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('compare'),
    jobId: z.string().max(300),
    rankingIds: z.array(z.string().max(200)).min(2).max(5),
  }),
  z.strictObject({
    op: z.literal('evaluate'),
    jobIds: z.array(z.string().max(300)).min(1).max(5),
    modelProfileId: z.uuid(),
    maxUsd: z.number().positive().max(10),
    consent: z.literal(true),
  }),
]);
export type CareerCommand = z.infer<typeof CareerCommandSchema>;
export const CareerResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    view: CareerViewSchema,
    exported: z
      .strictObject({ saved: z.boolean(), skipped: z.number().int().nonnegative() })
      .optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['IPC_FORBIDDEN', 'VALIDATION_ERROR', 'CAREER_ERROR', 'AI_REVIEW_FAILED']),
  }),
]);
export const CAREER_CHANNEL = 'career:command';
export interface CareerApi {
  careerCommand(command: CareerCommand): Promise<z.infer<typeof CareerResultSchema>>;
}
