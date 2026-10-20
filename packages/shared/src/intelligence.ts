import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const text = z.string().trim().max(4000);
export const PartialDateSchema = z.string().regex(/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/).refine((v) => {
  if (v.length !== 10) return true;
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
export const EvidenceSchema = z.strictObject({ id, sourceId: id, sourceKind: z.enum(['file', 'github', 'linkedin', 'user', 'legacy']), excerpt: text, sha256: z.string().regex(/^[a-f0-9]{64}$/), confidence: z.number().finite().min(0).max(1), verified: z.boolean(), location: z.string().max(400).optional(), sourceReliability: z.number().min(0).max(1).optional(), stance: z.enum(['supports', 'contradicts']).optional() });
const bound = { conflictWith: z.array(id).max(50).optional(), id, evidenceIds: z.array(id).min(1).max(50), verified: z.boolean() };
export const SkillEvidenceSchema = z.strictObject({ ...bound, skillId: id, version: z.string().max(40).nullable(), depth: z.enum(['production', 'project', 'supporting', 'course', 'declared']), proficiency: z.enum(['unspecified', 'beginner', 'working', 'advanced', 'expert']).optional(), recognition: z.enum(['explicit', 'contextual', 'inferred']).optional(), displayName: z.string().trim().min(1).max(200).optional() });
export const EducationSchema = z.strictObject({ ...bound, level: z.enum(['high-school', 'associate', 'bachelor', 'master', 'doctorate', 'other']), field: text, institution: text, status: z.enum(['completed', 'enrolled', 'expected', 'incomplete']), graduation: PartialDateSchema.nullable() });
export const ExperienceSchema = z.strictObject({ ...bound, title: text, organization: text, roleFamily: id, level: z.string().max(40), track: z.enum(['ic', 'management', 'unknown']), start: PartialDateSchema.nullable(), end: PartialDateSchema.nullable(), ongoing: z.boolean().optional(), skills: z.array(id).max(100), production: z.boolean() });
export const ProjectSchema = z.strictObject({ ...bound, name: text, description: text, roleFamily: id, skills: z.array(id).max(100), start: PartialDateSchema.nullable(), end: PartialDateSchema.nullable(), ongoing: z.boolean().optional(), production: z.boolean(), url: z.string().max(2048).nullable(), metadata: z.strictObject({ fork: z.boolean(), stars: z.number().int().nonnegative(), languages: z.record(z.string(), z.number().nonnegative()), documentation: z.string().max(16000), ownership: z.literal('unconfirmed') }).optional() });
export const CertificationSchema = z.strictObject({ ...bound, name: text, issuer: text, expires: PartialDateSchema.nullable(), license: z.boolean() });
export const IntelligenceSchema = z.strictObject({
  schemaVersion: z.literal('intelligence-v2'), evidence: z.array(EvidenceSchema).max(1000), skills: z.array(SkillEvidenceSchema).max(500), education: z.array(EducationSchema).max(50), experience: z.array(ExperienceSchema).max(100), projects: z.array(ProjectSchema).max(200), certifications: z.array(CertificationSchema).max(100),
}).superRefine((v, ctx) => {
  const evidence = new Map(v.evidence.map((e) => [e.id, e]));
  if (evidence.size !== v.evidence.length) ctx.addIssue({ code: 'custom', message: 'Duplicate evidence IDs' });
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const) {
    if (new Set(v[key].map((x) => x.id)).size !== v[key].length) ctx.addIssue({ code: 'custom', message: 'Duplicate qualification IDs', path: [key] });
    for (const item of v[key]) for (const ref of item.evidenceIds) {
      const e = evidence.get(ref);
      if (!e) ctx.addIssue({ code: 'custom', message: 'Qualification needs bound, verified evidence', path: [key] });
    }
    for (const item of v[key]) if (item.verified && !item.evidenceIds.some(ref => { const e = evidence.get(ref); return e?.verified && e.stance !== 'contradicts'; })) ctx.addIssue({ code: 'custom', message: 'Verified qualification needs verified supporting evidence', path: [key] });
  }
});
export type Intelligence = z.infer<typeof IntelligenceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export const RequirementSchema = z.strictObject({
  id, kind: z.enum(['skill', 'experience', 'education', 'certification', 'graduation', 'legal', 'unknown']), importance: z.enum(['required', 'preferred', 'mentioned', 'ambiguous']),
  section: z.string().max(300), excerpt: text, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), confidence: z.number().min(0).max(1),
  skillId: id.nullable(), versionRange: z.string().max(40).nullable(), months: z.number().finite().nonnegative().nullable(), roleFamily: id.nullable(), degree: z.string().max(40).nullable(), degreeField: z.string().max(300).nullable().default(null), relatedFieldsAllowed: z.boolean().default(false), enrollmentAllowed: z.boolean(), equivalentAllowed: z.boolean(), alternatives: z.array(id).max(20), graduationStart: z.number().int().nullable(), graduationEnd: z.number().int().nullable(),
});
export const RequirementSetSchema = z.strictObject({ parserVersion: z.literal('requirements-v2'), taxonomyVersion: z.enum(['rovdo-taxonomy-1', 'rovdo-taxonomy-2']), items: z.array(RequirementSchema).max(1000), role: z.strictObject({ family: id, specialty: z.string(), level: z.string(), track: z.enum(['ic', 'management', 'unknown']) }) });
export type Requirement = z.infer<typeof RequirementSchema>;
export type RequirementSet = z.infer<typeof RequirementSetSchema>;
export const COMPONENTS = ['skills', 'experience', 'projects', 'seniority', 'role', 'depth', 'education', 'lexical', 'location', 'salary', 'company', 'eligibility', 'preferences'] as const;
export const ComponentWeightsSchema = z.object(Object.fromEntries(COMPONENTS.map((k) => [k, z.number().finite().min(0).max(100)])) as Record<typeof COMPONENTS[number], z.ZodNumber>).strict().refine((v) => Object.values(v).reduce((a, b) => a + b, 0) > 0);
export const RankingProfileSchema = z.strictObject({
  id, name: z.string().trim().min(1).max(100), revision: z.number().int().positive(), schemaVersion: z.literal(1), method: z.enum(['legacy-v1', 'technical-v2', 'opportunity-v2']), weights: ComponentWeightsSchema,
  requiredMultiplier: z.number().finite().min(.1).max(10), preferredMultiplier: z.number().finite().min(.1).max(10), implicationCredit: z.number().min(0).max(1), minimumEvidence: z.number().min(0).max(1),
  gates: z.strictObject({ education: z.boolean(), location: z.boolean(), salary: z.boolean(), requiredSkills: z.boolean(), experience: z.boolean() }),
  thresholds: z.strictObject({ score: z.number().min(0).max(100), confidence: z.number().min(0).max(1), coverage: z.number().min(0).max(1) }),
}).superRefine((v, ctx) => {
  const allowed = v.method === 'technical-v2' ? ['skills', 'experience', 'projects', 'seniority', 'role', 'depth', 'education', 'lexical'] : v.method === 'legacy-v1' ? ['skills', 'role', 'location', 'eligibility', 'preferences'] : ['skills', 'role', 'experience', 'location', 'salary', 'education', 'lexical', 'company'];
  if (Object.entries(v.weights).some(([key, weight]) => weight > 0 && !allowed.includes(key))) ctx.addIssue({ code: 'custom', message: 'Weight does not belong to this ranking method' });
});
export type RankingProfile = z.infer<typeof RankingProfileSchema>;
export const RankingDetailsSchema = z.strictObject({
  method: z.enum(['legacy-v1', 'technical-v2', 'opportunity-v2']), configId: id, configRevision: z.number().int(), configHash: z.string(), taxonomyVersion: z.string(), parserVersion: z.string(), evidenceVersion: z.string(), asOf: z.string(), technicalScore: z.number().min(0).max(100).nullable(), preferenceScore: z.number().min(0).max(100).nullable(), requiredCoverage: z.number().min(0).max(1), shortlist: z.boolean(),
  components: z.array(z.strictObject({ name: z.string(), value: z.number().min(0).max(1).nullable(), configuredWeight: z.number(), activeWeight: z.number(), contribution: z.number(), confidence: z.number().min(0).max(1), explanation: z.string() })),
  requirements: z.array(z.strictObject({ id: z.string(), excerpt: z.string(), importance: z.string(), strength: z.number().min(0).max(1), evidenceIds: z.array(z.string()), explanation: z.string() })),
});
export type RankingDetails = z.infer<typeof RankingDetailsSchema>;
