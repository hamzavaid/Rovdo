/**
 * Import/appearance/ranking IPC contracts and the shared optional-AI privacy projection.
 * The consent UI and main service must use the same minimal outbound payload and source selection.
 */
import { ImportFailureCodeSchema } from './import-errors';
import { z } from 'zod';
import { IntelligenceSchema, RankingProfileSchema } from './intelligence';
import { CandidateProfileSchema, ProfileFactSchema } from './career';
export const ImportPreviewSchema = z.strictObject({
  id: z.string().min(1).max(200),
  parserVersion: z.enum(['profile-import-v1', 'profile-import-v2']),
  status: z.enum(['ready', 'accepted', 'rejected']),
  source: z.strictObject({
    id: z.string().max(200),
    name: z.string().max(200),
    kind: z.enum(['file', 'github', 'linkedin']),
    format: z.string().max(20),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: z.iso.datetime(),
  }),
  intelligence: IntelligenceSchema,
  facts: z.array(ProfileFactSchema).max(500),
  warnings: z.array(z.string().max(500)).max(50),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export const AppearanceSchema = z.enum(['light', 'dark', 'system']);
export type Appearance = z.infer<typeof AppearanceSchema>;
export const IntelligenceCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('appearance'), mode: AppearanceSchema }),
  z.strictObject({ op: z.literal('view') }),
  z.strictObject({ op: z.literal('importFile') }),
  z.strictObject({
    op: z.literal('paste'),
    text: z.string().min(1).max(200000),
    kind: z.enum(['linkedin', 'file']),
  }),
  z.strictObject({
    op: z.literal('github'),
    username: z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/),
    limit: z.number().int().min(1).max(20),
    consent: z.literal(true),
  }),
  z.strictObject({
    op: z.literal('assistImport'),
    id: z.string().max(200),
    modelProfileId: z.uuid(),
    maxUsd: z.number().positive().max(1),
    consent: z.literal(true),
    redactPii: z.boolean().optional(),
    evidenceIds: z.array(z.string().max(200)).max(1000).optional(),
  }),
  z.strictObject({
    op: z.literal('applyImport'),
    id: z.string().max(200),
    intelligence: IntelligenceSchema,
    facts: z.array(ProfileFactSchema).max(500),
    selectedIds: z.array(z.string().max(200)).max(2000),
    confirmSensitive: z.boolean(),
    reviewedCriticalIds: z.array(z.string().max(200)).max(1000).optional(),
  }),
  z.strictObject({ op: z.literal('rejectImport'), id: z.string().max(200) }),
  z.strictObject({
    op: z.literal('cloneRanking'),
    id: z.string().max(200),
    name: z.string().trim().min(1).max(100),
  }),
  z.strictObject({ op: z.literal('saveRanking'), profile: RankingProfileSchema }),
  z.strictObject({ op: z.literal('deleteRanking'), id: z.string().max(200) }),
  z.strictObject({ op: z.literal('importRanking'), json: z.string().min(1).max(20000) }),
  z.strictObject({
    op: z.literal('resetRanking'),
    id: z.string().max(200),
    presetId: z.string().max(200),
  }),
  z.strictObject({ op: z.literal('defaultRanking'), id: z.string().max(200) }),
]);
export type IntelligenceCommand = z.infer<typeof IntelligenceCommandSchema>;
export const IntelligenceViewSchema = z.strictObject({
  profile: CandidateProfileSchema.nullable(),
  rankings: z.array(RankingProfileSchema),
  defaultRanking: z.string(),
  appearance: AppearanceSchema.default('system'),
  previews: z.array(ImportPreviewSchema),
});
export type IntelligenceView = z.infer<typeof IntelligenceViewSchema>;
export const IntelligenceResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), view: IntelligenceViewSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      'VALIDATION_ERROR',
      'IPC_FORBIDDEN',
      'IMPORT_ERROR',
      'BUSY',
      ...ImportFailureCodeSchema.options,
    ]),
  }),
]);
export const INTELLIGENCE_CHANNEL = 'profile:intelligence';
export interface IntelligenceApi {
  intelligenceCommand(
    input: IntelligenceCommand,
  ): Promise<z.infer<typeof IntelligenceResultSchema>>;
}

// Same minimized source projection is used by the consent UI and privileged service.
export type ImportPrivacyOptions = {
  redactPii?: boolean | undefined;
  evidenceIds?: string[] | undefined;
};
/** Heuristic contact redaction for the consent preview; this is not a guarantee of anonymization. */
export function redactImportPii(text: string): string {
  return text
    .replace(
      /^\s*(?:name|address|phone|email|contact|date of birth|birth date)\s*:[^\n]*/gim,
      '[redacted contact line]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[redacted phone]')
    .replace(/https?:\/\/[^\s"<>]+/gi, '[redacted URL]');
}
export function importAssistancePayload(
  preview: ImportPreview,
  options: ImportPrivacyOptions = {},
) {
  const sensitive =
    /\b(?:citizenship|work authori[sz]ation|clearance|gender|ethnicity|religion|date of birth|birth date|marital status|passport|social security)\b/i;
  const chosen = options.evidenceIds ? new Set(options.evidenceIds) : null;
  const redact = options.redactPii !== false;
  // Sensitive assertions are always excluded; contact redaction and excerpt inclusion are user-controlled.
  const evidence = preview.intelligence.evidence
    .filter((e) => (!chosen || chosen.has(e.id)) && !sensitive.test(e.excerpt))
    .map(({ id, excerpt }) => ({ id, excerpt: redact ? redactImportPii(excerpt) : excerpt }));
  const allowed = new Set(evidence.map((e) => e.id));
  const fields: Record<string, string[]> = {
    skills: ['skillId', 'version'],
    experience: ['title', 'organization', 'start', 'end'],
    education: ['institution', 'field', 'graduation'],
    projects: ['name', 'start', 'end'],
    certifications: ['name', 'issuer', 'expires'],
  };
  const sections = ['skills', 'experience', 'education', 'projects', 'certifications'] as const;
  return {
    version: 'import-assistance-v2',
    evidence,
    records: Object.fromEntries(
      sections.map((key) => [
        key,
        preview.intelligence[key]
          .filter((r) => r.evidenceIds.some((id) => allowed.has(id)))
          .map((r) => ({
            id: r.id,
            evidenceIds: r.evidenceIds.filter((id) => allowed.has(id)),
            ...Object.fromEntries(
              Object.entries(r)
                .filter(([field]) => fields[key]!.includes(field))
                .map(([k, v]) => [k, redact && typeof v === 'string' ? redactImportPii(v) : v]),
            ),
          })),
      ]),
    ),
  };
}
