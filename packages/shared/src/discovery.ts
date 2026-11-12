/** Durable, provider-independent global discovery contracts. No AI or candidate contacts cross this API. */
import { z } from 'zod';
/** ISO 3166-1 assigned alpha-2 codes; no guessed or device-derived geography. */
export const COLLECTION_COUNTRIES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  );
export const CollectionScopeSchema = z.strictObject({
  version: z.literal(1),
  countries: z
    .array(z.string().refine((v) => COLLECTION_COUNTRIES.includes(v)))
    .min(1)
    .refine((v) => new Set(v).size === v.length),
  origin: z.enum(['profile', 'user']),
});
export type CollectionScope = z.infer<typeof CollectionScopeSchema>;
export const StoredCollectionScopeSchema = z.strictObject({
  scope: CollectionScopeSchema,
  revision: z.number().int().positive(),
});
const directoryText = z.string().trim().min(1).max(500);
const directoryHttps = z
  .string()
  .url()
  .refine((v) => {
    if (!URL.canParse(v)) return false;
    const url = new URL(v);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash;
  });
export function canonicalBoardUrl(raw: string): string {
  if (!URL.canParse(raw)) return raw;
  const url = new URL(raw);
  url.hostname = url.hostname
    .toLowerCase()
    .replace(/^boards\.greenhouse\.io$/, 'job-boards.greenhouse.io')
    .replace(/^jobs\.smartrecruiters\.com$/, 'careers.smartrecruiters.com');
  if (
    [
      'job-boards.greenhouse.io',
      'jobs.lever.co',
      'jobs.eu.lever.co',
      'jobs.ashbyhq.com',
      'careers.smartrecruiters.com',
    ].includes(url.hostname)
  ) {
    // These providers route every tenant path to the same case-insensitive board identity.
    const tenant = url.pathname.split('/')[1];
    if (tenant) {
      url.pathname = '/' + tenant.toLowerCase();
      url.search = '';
    }
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}
export const StarterEmployerSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,199}$/),
  name: directoryText,
  aliases: z.array(directoryText),
  categories: z.array(directoryText),
  referenceSets: z
    .array(
      z.strictObject({
        id: z.enum(['fortune-500', 'nasdaq-100', 'forbes-global-2000', 'broader']),
        edition: directoryText,
      }),
    )
    .min(1),
  boards: z
    .array(
      z.strictObject({
        url: directoryHttps,
        adapter: z.enum([
          'greenhouse',
          'lever',
          'ashby',
          'smartrecruiters',
          'jsonld',
          'workday',
          'unsupported',
        ]),
      }),
    )
    .min(1),
  provenance: z.array(z.strictObject({ url: directoryHttps, checkedAt: z.iso.datetime() })).min(1),
});
export const StarterDirectoryManifestSchema = z
  .strictObject({
    version: z.literal(1),
    releasedAt: z.iso.datetime(),
    employers: z.array(StarterEmployerSchema),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>(),
      urls = new Set<string>();
    for (const employer of manifest.employers) {
      if (ids.has(employer.id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate employer identity' });
      ids.add(employer.id);
      for (const board of employer.boards) {
        const url = canonicalBoardUrl(board.url);
        if (urls.has(url))
          ctx.addIssue({ code: 'custom', message: 'Duplicate canonical board URL' });
        urls.add(url);
      }
    }
  });
export type StarterEmployer = z.infer<typeof StarterEmployerSchema>;
export type StarterDirectoryManifest = z.infer<typeof StarterDirectoryManifestSchema>;
export const StarterDirectoryQuerySchema = z.strictObject({
  query: z.string().max(200).default(''),
  offset: z.number().int().nonnegative().default(0),
});
export const StarterDirectoryPageSchema = z.strictObject({
  rows: z.array(StarterEmployerSchema),
  total: z.number().int().nonnegative(),
});
export const JOB_SOURCE_IDS = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'remotive',
  'himalayas',
  'we-work-remotely',
  'simplify-new-grad-positions',
  'simplify-pitt-csc-summer-2027-internships',
  'vansh-new-grad-2027',
  'vansh-summer-2027-internships',
] as const;
export const BOARD_FINDER_IDS = ['wayback', 'common-crawl'] as const;
export const CompanyBoardSchema = z.strictObject({
  identity: z.string(),
  intervalMs: z.number().int().min(60000).max(2592000000).default(3600000),
  ats: z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters']),
  tenant: z.string(),
  region: z.enum(['global', 'eu']),
  company: z.string(),
  pageUrl: z.string().url(),
  nameStatus: z.enum(['known', 'pending', 'conflict']),
  enabled: z.boolean(),
  retiredAt: z.number().nullable(),
  discoveredAt: z.number(),
  observedAt: z.number(),
  validatedAt: z.number().nullable(),
  lastAttempt: z.number().nullable(),
  lastSuccess: z.number().nullable(),
  nextRefresh: z.number(),
  retryAt: z.number(),
  failures: z.number(),
  health: z.string(),
  complete: z.boolean(),
  contentHash: z.string().nullable(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  origin: z.string(),
});
export type CompanyBoard = z.infer<typeof CompanyBoardSchema>;
export const PipelineEventSchema = z.strictObject({
  sequence: z.number().int(),
  runId: z.uuid(),
  at: z.number(),
  stage: z.enum([
    'prepare',
    'acquire',
    'verify',
    'eligibility',
    'rank',
    'publish',
    'discover',
    'identify',
    'validate',
    'register',
  ]),
  status: z.enum(['running', 'complete', 'partial', 'paused', 'canceled', 'failed']),
  count: z.number().int().nonnegative(),
  reason: z.string().max(200).nullable(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;
export const RequestRecordSchema = z.strictObject({
  sequence: z.number().int(),
  runId: z.uuid(),
  sourceId: z.string(),
  at: z.number(),
  target: z.string().max(2048),
  status: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  bytes: z.number().int().nonnegative(),
  error: z.string().max(100).nullable(),
  cached: z.boolean(),
});
export const CompanyQuerySchema = z.strictObject({
  query: z.string().max(200).default(''),
  provider: z.enum(['all', 'greenhouse', 'lever', 'ashby', 'smartrecruiters']).default('all'),
  status: z.enum(['all', 'enabled', 'disabled', 'due', 'pending']).default('all'),
  offset: z.number().int().nonnegative().default(0),
  limit: z.union([z.literal(10), z.literal(25), z.literal(50)]).default(10),
});
export const CompanyPageSchema = z.strictObject({
  rows: z.array(CompanyBoardSchema),
  total: z.number().int(),
  verified: z.number().int(),
  enabled: z.number().int(),
  due: z.number().int(),
});
export const DiscoveryFiltersSchema = z.strictObject({
  keywords: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  workMode: z.enum(['all', 'remote', 'hybrid', 'onsite']).optional(),
  employmentType: z.string().max(40).optional(),
  freshnessDays: z.number().int().min(1).max(3650).optional(),
});
export const DiscoveryOptionsSchema = z.strictObject({
  sourceIds: z.array(z.string().max(200)).max(1000),
  overrides: z.record(z.string().max(200), DiscoveryFiltersSchema).default({}),
  filters: DiscoveryFiltersSchema.optional(),
});
export type DiscoveryOptions = z.infer<typeof DiscoveryOptionsSchema>;
export const RegistryEntrySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  mode: z.enum(['native-api', 'feed', 'repository', 'indexed', 'scraper', 'unsupported']),
  status: z.enum(['ready', 'configuration', 'blocked', 'unsupported']),
  adapter: z.string(),
  limitation: z.string(),
  policyUrl: z.string().url(),
});
export const DiscoveryRunSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['running', 'paused', 'completed', 'canceled']),
  lane: z.enum(['jobs', 'companies']).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  profileVersion: z.number().nullable(),
  collectionScope: StoredCollectionScopeSchema.nullable().optional(),
  scopeIdentity: z.string().optional(),
  queries: z.array(z.string().max(500)),
  options: DiscoveryOptionsSchema,
  reason: z.string().max(200).nullable(),
});
export type DiscoveryRun = z.infer<typeof DiscoveryRunSchema>;
export const DiscoveryTaskSchema = z.strictObject({
  id: z.string(),
  runId: z.uuid(),
  sourceId: z.string(),
  kind: z.enum(['provider', 'resolve', 'ats']),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'running', 'done', 'blocked']),
  nextAt: z.number(),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  priority: z.number(),
});
export type DiscoveryTask = z.infer<typeof DiscoveryTaskSchema>;
export const DiscoveryListingSchema = z.strictObject({
  id: z.string(),
  runId: z.uuid(),
  sourceId: z.string(),
  url: z.string().url().max(2048),
  title: z.string().max(500),
  companyEvidence: z.string().max(500).optional(),
  company: z.string().max(200).nullable(),
  location: z.string().max(500),
  description: z.string().max(100000),
  status: z.enum(['pending', 'resolved', 'blocked', 'incomplete']),
  reason: z.string().nullable(),
});
export type DiscoveryListing = z.infer<typeof DiscoveryListingSchema>;
export const DiscoveryCoverageSchema = z.strictObject({
  lastSuccessAt: z.number().nullable().optional(),
  nextRefreshAt: z.number().nullable().optional(),
  sourceId: z.string(),
  status: z.string(),
  requests: z.number(),
  records: z.number(),
  rejected: z.number(),
  error: z.string().nullable(),
  updatedAt: z.number(),
});
export const DiscoveryViewSchema = z.strictObject({
  metrics: z.record(z.string(), z.number().nonnegative()).optional(),
  events: z.array(PipelineEventSchema).default([]),
  plan: z.array(z.string()).default([]),
  run: DiscoveryRunSchema.nullable(),
  runs: z.array(DiscoveryRunSchema),
  registry: z.array(RegistryEntrySchema),
  coverage: z.array(DiscoveryCoverageSchema),
  listings: z.array(DiscoveryListingSchema),
  listingCount: z.number(),
  companies: z.number(),
  jobs: z.number(),
  pending: z.number(),
  done: z.number(),
  filtered: z.number().default(0),
});

/** Storage-only migration. IPC remains strict and rejects retired endpoint configuration. */
export function migrateDiscoveryOptions(input: Record<string, unknown>, historical = false) {
  const allowed = new Set<string>(
    historical ? [...JOB_SOURCE_IDS, ...BOARD_FINDER_IDS] : JOB_SOURCE_IDS,
  );
  const { indexUrl: retired, ...rest } = input;
  void retired;
  const ids = Array.isArray(input.sourceIds)
    ? input.sourceIds.filter((id): id is string => typeof id === 'string')
    : [];
  const sourceIds = ids.filter((id) => allowed.has(id));
  if (!historical && ids.length && !sourceIds.length) sourceIds.push(...JOB_SOURCE_IDS);
  return DiscoveryOptionsSchema.parse({
    ...rest,
    sourceIds: [...new Set(sourceIds)],
    overrides: Object.fromEntries(
      Object.entries((input.overrides ?? {}) as Record<string, unknown>).filter(([id]) =>
        allowed.has(id),
      ),
    ),
  });
}
