/**
 * Non-destructive canonical view across legacy facts and structured candidate intelligence.
 * Preserves source history while reconciling aliases, duplicate records, revoked approval and explicit conflicts.
 */
import { IntelligenceSchema } from '@rovdo/shared';
import type { CandidateProfile, Intelligence } from '@rovdo/shared';
import { resolveSkill } from './taxonomy';
export const CANDIDATE_POLICY_VERSION = 'canonical-candidate-v4';
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
  for (const skill of intel.skills)
    skill.skillId = resolveSkill(skill.skillId, 'skill')?.id ?? skill.skillId;
  for (const q of [...intel.experience, ...intel.projects])
    q.skills = [...new Set(q.skills.map((s) => resolveSkill(s, 'skill')?.id ?? s))];
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
  const evidenceById = new Map(intel.evidence.map((e) => [e.id, e]));
  const factsByEvidence = new Map(profile.facts.map((f) => [legacyId(f.id), f]));
  const factsBySource = new Map<string, CandidateProfile['facts']>();
  for (const fact of profile.facts)
    for (const source of new Set([`legacy:${fact.id}`, `legacy:${fact.id.slice(0, 180)}`]))
      factsBySource.set(source, [...(factsBySource.get(source) ?? []), fact]);
  // Recheck the original fact so a copied legacy assertion cannot outlive revoked verification.
  for (const e of intel.evidence)
    if (e.sourceKind === 'legacy') {
      // Prefer the full identity binding. Historical shortened sources are usable only
      // when unambiguous; one similarly prefixed fact must not revoke another's approval.
      const candidates = factsBySource.get(e.sourceId) ?? [];
      const fact =
        factsByEvidence.get(e.id) ?? (candidates.length === 1 ? candidates[0] : undefined);
      e.verified = !!fact?.verified && fact.value === e.excerpt;
    }
  for (const key of ['skills', 'experience', 'education', 'projects', 'certifications'] as const) {
    const target = intel[key] as Qualification[];
    for (const q of target)
      if (
        q.verified &&
        q.evidenceIds.some((id) => evidenceById.get(id)?.sourceKind === 'legacy') &&
        !q.evidenceIds.some((id) => evidenceById.get(id)?.verified)
      )
        q.verified = false;
    // Only natural-key peers can duplicate/conflict. Distinct skills are one Map insertion each.
    const groups = new Map<string, Qualification[]>();
    for (const q of target) {
      const key = qualificationKey(q);
      const group = groups.get(key) ?? [];
      group.push(q);
      groups.set(key, group);
    }
    const merged = new Set<Qualification>();
    for (const peers of groups.values()) {
      const signatures = new Map<string, Qualification>();
      for (const q of peers) {
        const signature = JSON.stringify(
          Object.fromEntries(
            Object.entries(q).filter(
              ([k]) => !['id', 'evidenceIds', 'verified', 'conflictWith'].includes(k),
            ),
          ),
        );
        const old = signatures.get(signature);
        if (old) {
          old.evidenceIds = [...new Set([...old.evidenceIds, ...q.evidenceIds])].slice(0, 50);
          old.verified ||= q.verified;
          old.conflictWith = [...new Set([...(old.conflictWith ?? []), ...(q.conflictWith ?? [])])];
          merged.add(q);
        } else signatures.set(signature, q);
      }
      const remaining = [...signatures.values()];
      for (let i = 0; i < remaining.length; i++)
        for (let j = i + 1; j < remaining.length; j++) {
          const a = remaining[i]!,
            b = remaining[j]!;
          if (a.verified && b.verified && qualificationsConflict(a, b)) {
            a.conflictWith = [...new Set([...(a.conflictWith ?? []), b.id])];
            b.conflictWith = [...new Set([...(b.conflictWith ?? []), a.id])];
          }
        }
    }
    target.splice(0, target.length, ...target.filter((q) => !merged.has(q)));
  }
  return IntelligenceSchema.parse(intel);
}
