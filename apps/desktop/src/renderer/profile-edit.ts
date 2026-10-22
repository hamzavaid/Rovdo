import { CandidateProfileSchema, IntelligenceSchema } from '@rovdo/shared';
import type { CandidateProfile } from '@rovdo/shared';
import { intelligenceOf, resolveSkill } from '@rovdo/career';
/**
 * Pure profile-draft edits plus explicit user-confirmation evidence creation.
 * Changing a qualification invalidates verification; reapproval adds a hashed assertion rather than altering source text.
 */
import type { Intelligence } from '@rovdo/shared';
export type QualificationSection =
  | 'skills'
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications';
/** Preserve identity/source links, but require approval again after any editable field changes. */
export function updateQualification(
  intelligence: Intelligence,
  section: QualificationSection,
  id: string,
  patch: Record<string, unknown>,
): Intelligence {
  return {
    ...intelligence,
    [section]: intelligence[section].map((item) =>
      item.id === id
        ? { ...item, ...patch, id, evidenceIds: item.evidenceIds, verified: false }
        : item,
    ),
  };
}
/** Add a new hashed user assertion while retaining previously verified source references. */
export async function confirmQualification(
  intelligence: Intelligence,
  section: QualificationSection,
  id: string,
): Promise<Intelligence> {
  const item = intelligence[section].find((item) => item.id === id);
  if (!item) return intelligence;
  const excerpt = JSON.stringify({ userConfirmed: item, previousEvidenceIds: item.evidenceIds });
  if (excerpt.length > 4000)
    throw new Error(
      'This record is too long to verify inline. Shorten it or review it through Imports.',
    );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(excerpt));
  const evidence = {
    id: crypto.randomUUID(),
    sourceId: `user:${id}`,
    sourceKind: 'user' as const,
    excerpt,
    sha256: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
    confidence: 1,
    verified: true,
  };
  const previous = item.evidenceIds.filter(
    (ref) => intelligence.evidence.find((e) => e.id === ref)?.verified,
  );
  return {
    ...intelligence,
    evidence: [...intelligence.evidence, evidence],
    [section]: intelligence[section].map((record) =>
      record.id === id
        ? { ...record, verified: true, conflictWith: [], evidenceIds: [...previous, evidence.id] }
        : record,
    ),
  };
}

/** Blank proposals have unknown dates, no production claim, and no verification. */
export function newQualification(
  section: QualificationSection,
): Intelligence[QualificationSection][number] {
  const bound = { id: crypto.randomUUID(), evidenceIds: ['pending'], verified: false };
  if (section === 'skills')
    return {
      ...bound,
      skillId: '',
      displayName: '',
      version: null,
      depth: 'declared',
      proficiency: 'unspecified',
      recognition: 'explicit',
    };
  if (section === 'experience')
    return {
      ...bound,
      title: '',
      organization: '',
      roleFamily: 'unknown',
      level: 'unknown',
      track: 'unknown',
      start: null,
      end: null,
      ongoing: false,
      skills: [],
      production: false,
    };
  if (section === 'education')
    return {
      ...bound,
      level: 'other',
      field: '',
      institution: '',
      status: 'incomplete',
      graduation: null,
      coursework: [],
    };
  if (section === 'projects')
    return {
      ...bound,
      name: '',
      description: '',
      roleFamily: 'unknown',
      skills: [],
      start: null,
      end: null,
      ongoing: false,
      production: false,
      url: null,
    };
  return { ...bound, name: '', issuer: '', expires: null, license: false };
}
export function canonicalSkill(value: string): string {
  return (
    resolveSkill(value, 'skill')?.id ??
    (value.startsWith('custom:')
      ? value
      : `custom:${value
          .normalize('NFKC')
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}+#.-]+/gu, '-')}`
    ).slice(0, 200)
  );
}
export function normalizeQualification(
  section: QualificationSection,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...input };
  const required =
    section === 'skills'
      ? ['skillId']
      : section === 'experience'
        ? ['title', 'organization']
        : section === 'education'
          ? ['institution']
          : section === 'projects'
            ? ['name', 'description']
            : ['name', 'issuer'];
  for (const key of required)
    if (typeof next[key] !== 'string' || !String(next[key]).trim())
      throw new Error(`Complete ${key === 'skillId' ? 'skill name' : key} before saving.`);
  if (section === 'skills') {
    const name = String(next.skillId).trim();
    next.skillId = canonicalSkill(name);
    next.displayName =
      resolveSkill(name, 'skill')?.name ?? String(next.displayName || name).replace(/^custom:/, '');
  }
  if (Array.isArray(next.skills))
    next.skills = [...new Set(next.skills.map((v) => canonicalSkill(String(v))).filter(Boolean))];
  if (next.url) {
    const url = new URL(String(next.url));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Use a public HTTP(S) project URL.');
  }
  return next;
}
/** New evidence is a proposal; equivalent verified skill fields always win over new draft values. */
export async function proposeQualification(
  profile: CandidateProfile,
  section: QualificationSection,
  input: Record<string, unknown>,
  reference: string,
): Promise<CandidateProfile> {
  if (!reference.trim()) throw new Error('Add a source reference or a clear user assertion.');
  const intel = intelligenceOf(profile),
    id = crypto.randomUUID();
  const normalized = normalizeQualification(section, input);
  const assertion = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => !['id', 'evidenceIds', 'verified'].includes(key)),
  );
  const excerpt = JSON.stringify({ qualification: assertion, reference: reference.trim() });
  if (excerpt.length > 4000)
    throw new Error('Shorten the entry or import it with supporting documents.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(excerpt));
  const evidence = {
    id: 'evidence:' + id,
    sourceId: 'user:' + id,
    sourceKind: 'user' as const,
    excerpt,
    sha256: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
    confidence: 1,
    verified: false,
  };
  intel.evidence.push(evidence);
  const item: Record<string, unknown> = {
    ...normalized,
    id,
    evidenceIds: [evidence.id],
    verified: false,
  };
  if (section === 'skills') {
    const old = intel.skills.find((s) => s.skillId === item.skillId);
    if (old) {
      old.evidenceIds = [...new Set([...old.evidenceIds, evidence.id])];
    } else (intel.skills as unknown[]).push(item);
  } else (intel[section] as unknown[]).push(item);
  return CandidateProfileSchema.parse({
    ...profile,
    intelligence: IntelligenceSchema.parse(intel),
  });
}
