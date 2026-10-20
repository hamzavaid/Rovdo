/**
 * Non-destructive canonical view across legacy facts and structured candidate intelligence.
 * Preserves source history while reconciling aliases, duplicate records, revoked approval and explicit conflicts.
 */
import { IntelligenceSchema } from '@rovdo/shared';
import type { CandidateProfile, Intelligence } from '@rovdo/shared';
import { resolveSkill } from './taxonomy';
export const CANDIDATE_POLICY_VERSION = 'canonical-candidate-v2';
export type Qualification =
  | Intelligence['skills'][number]
  | Intelligence['experience'][number]
  | Intelligence['education'][number]
  | Intelligence['projects'][number]
  | Intelligence['certifications'][number];
const normalized = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
/** A stable natural key for reconciliation, separate from a record's stored identity. */
export function qualificationKey(x: Qualification): string {
  if ('skillId' in x)
    return `skill:${resolveSkill(x.skillId, 'skill')?.id ?? normalized(x.skillId)}`;
  if ('organization' in x)
    return `work:${normalized(x.title)}|${normalized(x.organization)}|${x.start ?? ''}`;
  if ('institution' in x)
    return `education:${x.level}|${normalized(x.field)}|${normalized(x.institution)}`;
  return `${'url' in x ? 'project' : 'certification'}:${normalized(x.name)}|${'url' in x ? (x.url ?? '') : normalized(x.issuer)}`;
}
/** Flag explicit incompatible values for the same qualification; unknown fields are not contradictions. */
export function qualificationsConflict(a: Qualification, b: Qualification): boolean {
  if (qualificationKey(a) !== qualificationKey(b)) return false;
  const keys =
    'skillId' in a
      ? ['version']
      : 'organization' in a
        ? ['end', 'ongoing']
        : 'institution' in a
          ? ['status', 'graduation']
          : ['expires', 'start', 'end', 'description'];
  return keys.some((key) => {
    const av = (a as unknown as Record<string, unknown>)[key],
      bv = (b as unknown as Record<string, unknown>)[key];
    return av !== null && av !== undefined && bv !== null && bv !== undefined && av !== bv;
  });
}
const legacyId = (id: string) =>
  `legacy:${id.slice(0, 150)}:${Array.from(id).reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0}`;
/** Non-destructive compatibility projection. Stored facts/versions remain authoritative. */
export function intelligenceOf(profile: CandidateProfile): Intelligence {
  const intel = profile.intelligence
    ? IntelligenceSchema.parse(profile.intelligence)
    : ({
        schemaVersion: 'intelligence-v2' as const,
        evidence: [],
        skills: [],
        education: [],
        experience: [],
        projects: [],
        certifications: [],
      } as Intelligence);
  // Project legacy assertions conservatively; never manufacture typed employment or completion dates.
  for (const fact of profile.facts) {
    if (
      !['skill', 'degree', 'education', 'project', 'experience', 'graduationYear'].includes(
        fact.field,
      )
    )
      continue;
    const id = legacyId(fact.id);
    if (!intel.evidence.some((e) => e.id === id))
      intel.evidence.push({
        id,
        sourceId: `legacy:${fact.id.slice(0, 180)}`,
        sourceKind: 'legacy',
        excerpt: fact.value,
        sha256: '0'.repeat(64),
        confidence: fact.source.kind === 'user' ? 0.9 : 0.75,
        verified: fact.verified,
      });
    const bound = { id, evidenceIds: [id], verified: fact.verified };
    if (fact.field === 'skill') {
      const known = resolveSkill(fact.value, 'skill');
      const skillId =
        known?.id ??
        `custom:${normalized(fact.value).replace(/[^\p{L}\p{N}+#.-]+/gu, '-')}`.slice(0, 200);
      const old = intel.skills.find((s) => qualificationKey(s) === `skill:${skillId}`);
      if (!old)
        intel.skills.push({
          ...bound,
          skillId,
          displayName: known?.name ?? fact.value.slice(0, 200),
          version: null,
          depth: 'declared',
        });
      else if (!old.verified && fact.verified)
        Object.assign(old, {
          ...bound,
          id: old.id,
          skillId,
          version: null,
          depth: 'declared',
          evidenceIds: [...new Set([...old.evidenceIds, id])].slice(0, 50),
        });
      else old.evidenceIds = [...new Set([...old.evidenceIds, id])].slice(0, 50);
    } else if (fact.field === 'degree' || fact.field === 'education') {
      const level = /bachelor|master|doctorate|associate|high-school/i
        .exec(fact.value)?.[0]
        ?.toLowerCase();
      if (!level) continue;
      const old = intel.education.find(
        (e) =>
          e.level === level &&
          e.evidenceIds.some(
            (ref) => intel.evidence.find((e) => e.id === ref)?.excerpt === fact.value,
          ),
      );
      if (old) {
        old.evidenceIds = [...new Set([...old.evidenceIds, id])].slice(0, 50);
        continue;
      }
      intel.education.push({
        ...bound,
        level: level as Intelligence['education'][number]['level'],
        field: '',
        institution: '',
        status: /expected/i.test(fact.value)
          ? 'expected'
          : /enroll|pursu/i.test(fact.value)
            ? 'enrolled'
            : /completed|earned|graduated/i.test(fact.value)
              ? 'completed'
              : 'incomplete',
        graduation: null,
      });
    }
    // Free-form employment/project assertions remain accessible in facts. No typed dates,
    // employers, completed degrees or project authorship are invented from them.
  }
  // Recheck the original fact so a copied legacy assertion cannot outlive revoked verification.
  for (const e of intel.evidence)
    if (e.sourceKind === 'legacy') {
      const fact = profile.facts.find(
        (f) => e.sourceId === `legacy:${f.id}` || e.sourceId === `legacy:${f.id.slice(0, 180)}`,
      );
      e.verified = !!fact?.verified && fact.value === e.excerpt;
    }
  for (const key of ['skills', 'experience', 'education', 'projects', 'certifications'] as const) {
    const target = intel[key] as Qualification[];
    for (const q of target)
      if (
        q.verified &&
        q.evidenceIds.some(
          (id) => intel.evidence.find((e) => e.id === id)?.sourceKind === 'legacy',
        ) &&
        !q.evidenceIds.some((id) => intel.evidence.find((e) => e.id === id)?.verified)
      )
        q.verified = false;
    for (let i = 0; i < target.length; i++)
      for (let j = i + 1; j < target.length; j++) {
        const a = target[i]!,
          b = target[j]!;
        if (
          qualificationKey(a) === qualificationKey(b) &&
          !qualificationsConflict(a, b) &&
          JSON.stringify(
            Object.fromEntries(
              Object.entries(a).filter(
                ([k]) => !['id', 'evidenceIds', 'verified', 'conflictWith'].includes(k),
              ),
            ),
          ) ===
            JSON.stringify(
              Object.fromEntries(
                Object.entries(b).filter(
                  ([k]) => !['id', 'evidenceIds', 'verified', 'conflictWith'].includes(k),
                ),
              ),
            )
        ) {
          a.evidenceIds = [...new Set([...a.evidenceIds, ...b.evidenceIds])].slice(0, 50);
          a.verified = a.verified || b.verified;
          target.splice(j--, 1);
          continue;
        }
        if (a.verified && b.verified && qualificationsConflict(a, b)) {
          a.conflictWith = [...new Set([...(a.conflictWith ?? []), b.id])];
          b.conflictWith = [...new Set([...(b.conflictWith ?? []), a.id])];
        }
      }
  }
  return IntelligenceSchema.parse(intel);
}
