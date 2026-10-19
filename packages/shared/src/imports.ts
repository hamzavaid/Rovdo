import { z } from 'zod';
import { IntelligenceSchema, RankingProfileSchema } from './intelligence';
import { CandidateProfileSchema, ProfileFactSchema } from './career';
export const ImportPreviewSchema = z.strictObject({
  id: z.string().min(1).max(200), parserVersion: z.enum(['profile-import-v1', 'profile-import-v2']), status: z.enum(['ready', 'accepted', 'rejected']),
  source: z.strictObject({ id: z.string().max(200), name: z.string().max(200), kind: z.enum(['file', 'github', 'linkedin']), format: z.string().max(20), sha256: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: z.iso.datetime() }),
  intelligence: IntelligenceSchema, facts: z.array(ProfileFactSchema).max(500), warnings: z.array(z.string().max(500)).max(50),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export const AppearanceSchema = z.enum(['light', 'dark', 'system']);
export type Appearance = z.infer<typeof AppearanceSchema>;
export const IntelligenceCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('appearance'), mode: AppearanceSchema }),
  z.strictObject({ op: z.literal('view') }), z.strictObject({ op: z.literal('importFile') }),
  z.strictObject({ op: z.literal('paste'), text: z.string().min(1).max(200000), kind: z.enum(['linkedin', 'file']) }),
  z.strictObject({ op: z.literal('github'), username: z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/), limit: z.number().int().min(1).max(20), consent: z.literal(true) }),
  z.strictObject({ op: z.literal('applyImport'), id: z.string().max(200), intelligence: IntelligenceSchema, facts: z.array(ProfileFactSchema).max(500), selectedIds: z.array(z.string().max(200)).max(2000), confirmSensitive: z.boolean() }),
  z.strictObject({ op: z.literal('rejectImport'), id: z.string().max(200) }),
  z.strictObject({ op: z.literal('cloneRanking'), id: z.string().max(200), name: z.string().trim().min(1).max(100) }),
  z.strictObject({ op: z.literal('saveRanking'), profile: RankingProfileSchema }),
  z.strictObject({ op: z.literal('deleteRanking'), id: z.string().max(200) }),
  z.strictObject({ op: z.literal('importRanking'), json: z.string().min(1).max(20000) }),
  z.strictObject({ op: z.literal('resetRanking'), id: z.string().max(200), presetId: z.string().max(200) }),
  z.strictObject({ op: z.literal('defaultRanking'), id: z.string().max(200) }),
]);
export type IntelligenceCommand = z.infer<typeof IntelligenceCommandSchema>;
export const IntelligenceViewSchema = z.strictObject({ profile: CandidateProfileSchema.nullable(), rankings: z.array(RankingProfileSchema), defaultRanking: z.string(), appearance: AppearanceSchema.default('system'), previews: z.array(ImportPreviewSchema) });
export type IntelligenceView = z.infer<typeof IntelligenceViewSchema>;
export const IntelligenceResultSchema = z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), view: IntelligenceViewSchema }), z.strictObject({ ok: z.literal(false), code: z.enum(['VALIDATION_ERROR', 'IPC_FORBIDDEN', 'IMPORT_ERROR', 'BUSY']) })]);
export const INTELLIGENCE_CHANNEL = 'profile:intelligence';
export interface IntelligenceApi { intelligenceCommand(input: IntelligenceCommand): Promise<z.infer<typeof IntelligenceResultSchema>> }
