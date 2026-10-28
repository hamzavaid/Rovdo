/**
 * Conservative job-requirement extraction with source offsets and required/preferred distinctions.
 * Also supplies degree gates and overlap-safe employment duration; unknown evidence never implies completion.
 */
import type { Requirement, RequirementSet } from '@rovdo/shared';
import { PartialDateSchema } from '@rovdo/shared';
import { SKILLS, TAXONOMY_VERSION, roleOf } from './taxonomy';
export const REQUIREMENTS_PARSER_VERSION = 'requirements-v4';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliases = SKILLS.flatMap((skill) =>
  skill.aliases.map((alias) => ({
    skillId: skill.id,
    ...alias,
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}_.+#])${escape(alias.label)}(?![\p{L}\p{N}_.+#]|\.(?=\S))`,
      'iu',
    ),
  })),
);
/** Split explicit contrasts while preserving exact offsets into the original posting text. */
function clauses(text: string): { line: string; offset: number }[] {
  const result: { line: string; offset: number }[] = [];
  for (const match of text.matchAll(/[^\n\r]+/g)) {
    const line = match[0];
    let cursor = 0;
    const separators =
      /;\s*|,\s*(?=(?:no|not|but)\b|[A-Z][\w+#. -]{0,30}\s+(?:is\s+)?(?:required|preferred|optional)\b)|\s+but\s+|\s+and\s+(?=[A-Z][\w+#. -]{0,30}\s+(?:is\s+)?(?:required|preferred|optional)\b)/g;
    for (const separator of line.matchAll(separators)) {
      if (separator.index! > cursor)
        result.push({ line: line.slice(cursor, separator.index), offset: match.index! + cursor });
      cursor = separator.index! + separator[0].length;
    }
    if (cursor < line.length)
      result.push({ line: line.slice(cursor), offset: match.index! + cursor });
  }
  return result;
}
export function extractRequirements(text: string, title: string): RequirementSet {
  const items: Requirement[] = [];
  let section = '';
  let sectionImportance: Requirement['importance'] = 'ambiguous';
  for (const part of clauses(text)) {
    let line = part.line.slice(0, 4000),
      offset = part.offset;
    // ATS list headings often share a line with their first bullet. Preserve exact source offsets.
    const inline =
      /^\s*(?:[-#*]+\s*)?((?:(?:minimum|required|preferred|nice.to.have)(?: qualifications| requirements| skills)?|qualifications|requirements|responsibilities|about us|benefits))\s*:\s*/i.exec(
        line,
      );
    if (inline) {
      section = inline[1]!;
      sectionImportance = /preferred|nice.to.have/i.test(section)
        ? 'preferred'
        : /required|minimum|requirements/i.test(section)
          ? 'required'
          : /responsibilities|about us|benefits/i.test(section)
            ? 'mentioned'
            : 'ambiguous';
      offset += inline[0].length;
      line = line.slice(inline[0].length);
      if (!line.trim()) continue;
    }
    const trimmed = line.trim().replace(/^[-#*]+\s*/, '');
    if (
      /^(?:(?:minimum|required|preferred|nice.to.have)(?: qualifications| requirements| skills)?|qualifications|requirements|responsibilities|about us|benefits)\s*:?$/i.test(
        trimmed,
      )
    ) {
      section = trimmed;
      sectionImportance = /preferred|nice.to.have/i.test(trimmed)
        ? 'preferred'
        : /required|minimum|requirements/i.test(trimmed)
          ? 'required'
          : /responsibilities|about us|benefits/i.test(trimmed)
            ? 'mentioned'
            : 'ambiguous';
      continue;
    }
    if (/about us|benefits/i.test(section)) continue;
    // Conservative clause negation: no absence is converted into a mandatory skill/degree.
    if (
      !/not only/i.test(line) &&
      (/^not\b/i.test(trimmed) ||
        /\b(?:no\b.{0,70}(?:required|necessary|needed)|not (?:required|necessary|mandatory|needed|a (?:requirement|prerequisite))|must not|do not (?:require|use)|without\b.{0,40}(?:degree|experience))/i.test(
          line,
        ))
    )
      continue;
    const required = /\brequired|\bmust\b/i.test(line),
      preferred = /\bpreferred|nice.to.have|\bbonus\b|\boptional\b|a plus/i.test(line);
    const importance: Requirement['importance'] =
      required && preferred
        ? 'ambiguous'
        : preferred
          ? 'preferred'
          : required
            ? 'required'
            : sectionImportance;
    const base: Omit<Requirement, 'id' | 'kind'> = {
      importance,
      section,
      excerpt: line,
      start: offset,
      end: offset + line.length,
      confidence: importance === 'ambiguous' ? 0.55 : 0.95,
      skillId: null,
      versionRange: null,
      months: null,
      roleFamily: null,
      degree: null,
      degreeField: null,
      relatedFieldsAllowed: false,
      enrollmentAllowed: false,
      equivalentAllowed: false,
      alternatives: [],
      graduationStart: null,
      graduationEnd: null,
    };
    const add = (kind: Requirement['kind'], extra: Partial<Requirement>) => {
      items.push({ ...base, kind, id: `r${items.length}`, alternatives: [], ...extra });
      return items.at(-1)!;
    };
    const context =
      importance === 'required' ||
      importance === 'preferred' ||
      /skills?|technolog|stack|programming|experience (?:with|in)/i.test(`${section} ${line}`);
    const found = aliases.flatMap((alias) => {
      if (alias.context !== 'any' && !context) return [];
      const m = alias.pattern.exec(line);
      return m ? [{ ...alias, start: m.index, end: m.index + m[0].length }] : [];
    });
    // Prefer the longest overlapping alias: C++ must not also create a C requirement.
    const tokens = found
      .filter(
        (a) =>
          !found.some(
            (b) =>
              b.skillId !== a.skillId &&
              b.start <= a.start &&
              b.end >= a.end &&
              b.end - b.start > a.end - a.start,
          ),
      )
      .sort((a, b) => a.start - b.start || b.end - a.end || a.skillId.localeCompare(b.skillId));
    const seen = new Set<string>();
    let previous: (typeof tokens)[number] | undefined;
    let group: Requirement | undefined;
    for (const token of tokens) {
      if (seen.has(token.skillId)) continue;
      seen.add(token.skillId);
      if (previous && group && /^\s*(?:or|\/)\s*$/i.test(line.slice(previous.end, token.start)))
        group.alternatives.push(token.skillId);
      else {
        const version = /^\s*(>=|<=|>|<|\^|~|=)?\s*(\d+(?:\.\d+){0,2})/.exec(line.slice(token.end));
        group = add('skill', {
          skillId: token.skillId,
          versionRange: version ? `${version[1] ?? '='}${version[2]}` : null,
        });
      }
      previous = token;
    }
    const years =
      /(\d+(?:\.\d+)?)\s*\+?\s*(years?|months?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|hands.on\s+)?(?:[a-z]+\s+)?experience/i.exec(
        line,
      );
    if (years)
      add('experience', {
        months: Number(years[1]) * (/year/i.test(years[2]!) ? 12 : 1),
        roleFamily: roleOf(title).family,
        skillId: items.find((x) => x.start === offset && x.kind === 'skill')?.skillId ?? null,
      });
    const degree = /\b(bachelor|master|doctorate|ph\.?d|associate|high.school)(?:'?s)?\b/i.exec(
      line,
    );
    if (degree)
      add('education', {
        degree: /ph\.?d/i.test(degree[1]!)
          ? 'doctorate'
          : degree[1]!.toLowerCase().replace(' ', '-'),
        degreeField:
          /\bin\s+(.+?)(?=\s+(?:required|preferred|or equivalent|or related)|[.;]|$)/i
            .exec(line)?.[1]
            ?.trim()
            .slice(0, 300) ?? null,
        relatedFieldsAllowed: /related field|or related/i.test(line),
        equivalentAllowed: /or equivalent|equivalent (?:practical |professional )?experience/i.test(
          line,
        ),
        enrollmentAllowed: /enrolled|pursuing|currently studying|expected/i.test(line),
      });
    const graduation = /graduat\w*[^\d\n]{0,50}(20\d{2})(?:\s*[-\u2013\u2014]\s*(20\d{2}))?/i.exec(
      line,
    );
    if (graduation)
      add('graduation', {
        graduationStart: Number(graduation[1]),
        graduationEnd: Number(graduation[2] ?? graduation[1]),
      });
    if (/citizenship|work authori[sz]|authorized to work|clearance|return to school/i.test(line))
      add('legal', {});
    if (/\bcertification|\blicen[cs]e\b/i.test(line)) {
      // Named credentials are separate requirements. Unknown credential prose remains reviewable.
      const credentials = [
        ...line.matchAll(/\b(CPA|PMP|CISSP|CISM|CISA|CCNA|CCNP|RN|PE|EIT)\b/g),
      ].map((m) => m[1]!);
      const alternative =
        credentials.length > 1 &&
        new RegExp('\\b' + credentials.join('\\s+(?:or|/)\\s+') + '\\b').test(line);
      if (alternative)
        add('certification', { credential: credentials[0]!, alternatives: credentials.slice(1) });
      else if (credentials.length)
        for (const credential of new Set(credentials)) add('certification', { credential });
      else add('certification', {});
    }
  }
  return {
    parserVersion: REQUIREMENTS_PARSER_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    items,
    role: roleOf(title),
  };
}
const degrees = ['high-school', 'associate', 'bachelor', 'master', 'doctorate'];
/** Return UNKNOWN for missing completion/field/equivalence evidence rather than guessing eligibility. */
export function degreeGate(
  candidate: { level: string; status: string; graduation: string | null; field?: string } | null,
  required: {
    level: string;
    enrollmentAllowed: boolean;
    equivalentAllowed: boolean;
    field?: string | null;
    relatedFieldsAllowed?: boolean;
  },
): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (!candidate) return 'UNKNOWN';
  const actual = degrees.indexOf(candidate.level);
  const needed = degrees.indexOf(required.level);
  if (actual < 0 || needed < 0) return 'UNKNOWN';
  if (
    candidate.status !== 'completed' &&
    !(required.enrollmentAllowed && ['enrolled', 'expected'].includes(candidate.status))
  )
    return 'UNKNOWN';
  if (required.field) {
    if (!candidate.field) return 'UNKNOWN';
    const normalize = (v: string) =>
      v
        .toLowerCase()
        .replace(/\bcs\b/g, 'computer science')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (
      !required.field
        .split(/,|\/|\bor\b/i)
        .some((f) => normalize(f) === normalize(candidate.field!))
    )
      return required.relatedFieldsAllowed || required.equivalentAllowed ? 'UNKNOWN' : 'FAIL';
  }
  return actual >= needed ? 'PASS' : required.equivalentAllowed ? 'UNKNOWN' : 'FAIL';
}
function monthIndex(value: string, end: boolean): number | null {
  if (!PartialDateSchema.safeParse(value).success) return null;
  const [year, month = end ? 12 : 1, day = 1] = value.split('-').map(Number);
  return (
    year! * 12 +
    month -
    1 +
    (value.length <= 7 && end ? 1 : (day - 1) / new Date(Date.UTC(year!, month, 0)).getUTCDate())
  );
}
/** Semantic requirements count once; retain all original extracts separately for provenance. */
export function scoringRequirements(items: readonly Requirement[]): Requirement[] {
  const seen = new Map<string, Requirement>();
  const priority = { required: 3, preferred: 2, ambiguous: 1, mentioned: 0 };
  for (const r of items) {
    if (r.importance === 'mentioned') continue;
    const key = JSON.stringify([
      r.kind,
      r.kind === 'skill' ? [r.skillId, ...r.alternatives].sort() : r.skillId,
      r.versionRange,
      r.months,
      r.roleFamily,
      r.degree,
      r.degreeField,
      r.enrollmentAllowed,
      r.equivalentAllowed,
      r.relatedFieldsAllowed,
      r.graduationStart,
      r.graduationEnd,
      r.credential ?? (r.kind === 'certification' ? r.excerpt.trim().toLowerCase() : null),
      r.kind === 'certification' ? [...r.alternatives].sort() : null,
    ]);
    const old = seen.get(key);
    if (!old || priority[r.importance] > priority[old.importance]) seen.set(key, r);
  }
  return [...seen.values()];
}
/** Coarse expiry precision is uncertainty during that period, not a fabricated exact day. */
export function credentialStatus(
  expires: string | null,
  asOf: string,
): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (!expires) return 'PASS';
  if (!PartialDateSchema.safeParse(expires).success) return 'UNKNOWN';
  const current = asOf.slice(0, expires.length);
  return expires < current
    ? 'FAIL'
    : expires > current || expires.length === 10
      ? 'PASS'
      : 'UNKNOWN';
}
/** Merge overlapping intervals; count an unknown end only when ongoing employment is explicit. */
export function unionMonths(
  intervals: { start: string | null; end: string | null; ongoing?: boolean | undefined }[],
  asOf: string,
): number {
  const now = monthIndex(asOf, false);
  if (now === null) return 0;
  const sorted = intervals
    .flatMap((i) => {
      if (!i.end && i.ongoing !== true) return [];
      const start = i.start ? monthIndex(i.start, false) : null;
      const end = i.end ? monthIndex(i.end, true) : now;
      return start !== null && end !== null && end > start && start < now
        ? [[start, Math.min(end, now)] as [number, number]]
        : [];
    })
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let right = -Infinity;
  for (const [start, end] of sorted) {
    if (end > right) total += end - Math.max(start, right);
    right = Math.max(end, right);
  }
  return Math.round(total * 1000) / 1000;
}
