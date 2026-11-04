/** Deterministic query expansion is discovery prioritization, never a replacement scorer. */
import type { CandidateProfile } from '@rovdo/shared';
import { qualificationSupport } from '@rovdo/shared';
import { intelligenceOf, resolveSkill } from '@rovdo/career';
const clean = (s: string) =>
  s
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]+/gi, '')
    .replace(/[^\p{L}\p{N} +#./-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
export function discoveryQueries(
  profile: CandidateProfile | null,
  minimumEvidence = 0.5,
): string[] {
  if (!profile) return ['jobs hiring careers'];
  const i = intelligenceOf(profile);
  const evidence = new Map(i.evidence.map((e) => [e.id, e]));
  const usable = <T extends { verified: boolean; evidenceIds: string[] }>(xs: T[]) =>
    xs.filter(
      (q) =>
        qualificationSupport(q, evidence).confidence >= minimumEvidence &&
        qualificationSupport(q, evidence).confidence > 0,
    );
  const name = (id: string) => resolveSkill(id, 'skill')?.name ?? id.replace(/^custom:/, '');
  const skills = [
    ...new Set(
      [
        ...usable(i.skills).map((q) => name(q.skillId)),
        ...usable(i.projects).flatMap((q) => q.skills.map(name)),
        ...usable(i.experience).flatMap((q) => q.skills.map(name)),
      ]
        .map(clean)
        .filter(Boolean),
    ),
  ].sort();
  const roles = [
    ...new Set(
      [...profile.preferences.roles, ...usable(i.experience).map((q) => q.title)]
        .map(clean)
        .filter(Boolean),
    ),
  ].sort();
  const queries = new Set<string>();
  const add = (s: string) => {
    const value = s.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (value && queries.size < 8) queries.add(value);
  };
  // A small intent plan is independent of result pagination: never cap the job inventory.
  for (const role of roles.slice(0, 2)) {
    add(`${role} jobs`);
    for (const location of profile.preferences.locations.map(clean).filter(Boolean).slice(0, 1))
      add(`${role} ${location} jobs`);
  }
  skills.forEach((skill, index) => {
    add(`${skill} ${roles[index % Math.max(1, roles.length)] ?? 'engineer'} jobs`);
  });
  for (const q of usable(i.education))
    if (q.field) add(`${clean(q.field)} ${roles[0] ?? 'technical'} jobs`);
  for (const role of roles)
    if (/verilog|fpga|asic/i.test(skills.join(' '))) add(`${role} FPGA ASIC hardware jobs`);
  if (!queries.size) add('jobs hiring careers');
  return [...queries];
}
