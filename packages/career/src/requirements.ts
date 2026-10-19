import type { Requirement, RequirementSet } from '@rovdo/shared';
import { SKILLS, TAXONOMY_VERSION, roleOf } from './taxonomy';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skillMatchers = SKILLS.map(skill => ({...skill, aliases: skill.aliases.map(a => ({...a, pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}_.])${escape(a.label)}(?=$|[^\\p{L}\\p{N}_.]|\\.(?=\\s|$))`, 'iu')}))}));
export function extractRequirements(text: string, title: string): RequirementSet {
  const items: Requirement[] = []; let section = ''; let sectionImportance: Requirement['importance'] = 'ambiguous';
  for (const match of text.matchAll(/[^\n\r]+/g)) {
    const line = match[0]; const offset = match.index;
    if (/^(?:\s*[-#*]*\s*)(?:minimum|required|preferred|nice.to.have|qualifications|requirements|responsibilities|about us)/i.test(line.trim()) && line.trim().length < 90 && !/\b(?:years|degree|skills:)\b/i.test(line)) {
      section = line.trim(); sectionImportance = /preferred|nice.to.have/i.test(line) ? 'preferred' : /required|minimum|requirements/i.test(line) ? 'required' : 'mentioned';
    }
    const importance: Requirement['importance'] = /\bpreferred|nice.to.have|bonus\b/i.test(line) ? 'preferred' : /\brequired|must\b/i.test(line) ? 'required' : sectionImportance;
    const base: Omit<Requirement, 'id' | 'kind'> = { importance, section, excerpt: line.slice(0, 4000), start: offset, end: offset + Math.min(line.length, 4000), confidence: importance === 'ambiguous' ? .55 : .95, skillId: null, versionRange: null, months: null, roleFamily: null, degree: null, degreeField: null, relatedFieldsAllowed: false, enrollmentAllowed: false, equivalentAllowed: false, alternatives: [], graduationStart: null, graduationEnd: null };
    const add = (kind: Requirement['kind'], extra: Partial<Requirement>) => { items.push({ ...base, alternatives: [], kind, id: `r${items.length}`, ...extra }); };
    const skillContext = importance === 'required' || importance === 'preferred' || /skills?|technolog|stack|programming|experience (?:with|in)/i.test(`${section} ${line}`);
    if (!/about us|benefits|company/i.test(section)) for (const skill of skillMatchers) {
      const found = skill.aliases.find((a) => (a.context === 'any' || skillContext) && a.pattern.test(line));
      if (found) {
        const version = new RegExp(`${escape(found.label)}\\s*(>=|<=|>|<|\\^|~|=)?\\s*(\\d+(?:\\.\\d+){0,2})`, 'i').exec(line);
        add('skill', { skillId: skill.id, versionRange: version ? `${version[1] ?? '='}${version[2]}` : null });
      }
    }
    const years = /(\d+(?:\.\d+)?)\s*\+?\s*(years?|months?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|hands.on\s+)?(?:[a-z]+\s+)?experience/i.exec(line);
    if (years) add('experience', { months: Number(years[1]) * (/year/i.test(years[2]!) ? 12 : 1), roleFamily: roleOf(title).family, skillId: items.filter((x) => x.start === offset && x.kind === 'skill')[0]?.skillId ?? null });
    const degree = /\b(bachelor|master|doctorate|ph\.?d|associate|high.school)(?:'?s)?\b/i.exec(line);
    if (degree) add('education', { degree: /ph\.?d/i.test(degree[1]!) ? 'doctorate' : degree[1]!.toLowerCase().replace(' ', '-'), degreeField: /\bin\s+(.+?)(?=\s+(?:required|preferred|or equivalent|or related)|[.;]|$)/i.exec(line)?.[1]?.trim().slice(0, 300) ?? null, relatedFieldsAllowed: /related field|or related/i.test(line), equivalentAllowed: /or equivalent|equivalent (?:practical |professional )?experience/i.test(line), enrollmentAllowed: /enrolled|pursuing|currently studying|expected/i.test(line) });
    const graduation = /graduat\w*[^\d\n]{0,50}(20\d{2})(?:\s*[-–]\s*(20\d{2}))?/i.exec(line);
    if (graduation) add('graduation', { graduationStart: Number(graduation[1]), graduationEnd: Number(graduation[2] ?? graduation[1]) });
    if (/citizenship|work authori[sz]|authorized to work|clearance|return to school/i.test(line)) add('legal', {});
    if (/\bcertification|\blicen[cs]e\b/i.test(line)) add('certification', {});
  }
  // Merge only adjacent explicit alternatives; "TypeScript and AWS or Azure"
  // retains the mandatory TypeScript requirement independently of the cloud choice.
  const removed = new Set<string>();
  for (const start of new Set(items.filter((r) => r.kind === 'skill').map((r) => r.start))) {
    const tokens = items.filter((r) => r.kind === 'skill' && r.start === start).map((r) => {
      const skill = SKILLS.find((s) => s.id === r.skillId)!;
      const found = skill.aliases.flatMap((a) => { const m = new RegExp(`(?<![\\p{L}\\p{N}_.])${escape(a.label)}(?![\\p{L}\\p{N}_])`, 'iu').exec(r.excerpt); return m ? [{ start: m.index, end: m.index + m[0].length }] : []; }).sort((a, b) => a.start - b.start || b.end - a.end)[0]!;
      return { r, ...found };
    }).sort((a, b) => a.start - b.start);
    let group = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
      const previous = tokens[i - 1]!; const next = tokens[i]!;
      if (/^\s*(?:or|\/)\s*$/i.test(next.r.excerpt.slice(previous.end, next.start))) { group!.r.alternatives.push(next.r.skillId!); removed.add(next.r.id); }
      else group = next;
    }
  }
  return { parserVersion: 'requirements-v2', taxonomyVersion: TAXONOMY_VERSION, items: items.filter((r) => !removed.has(r.id)), role: roleOf(title) };
}
const degrees = ['high-school', 'associate', 'bachelor', 'master', 'doctorate'];
export function degreeGate(candidate: { level: string; status: string; graduation: string | null; field?: string } | null, required: { level: string; enrollmentAllowed: boolean; equivalentAllowed: boolean; field?: string | null; relatedFieldsAllowed?: boolean }): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (!candidate) return 'UNKNOWN';
  const actual = degrees.indexOf(candidate.level); const needed = degrees.indexOf(required.level);
  if (actual < 0 || needed < 0) return 'UNKNOWN';
  if (candidate.status !== 'completed' && !(required.enrollmentAllowed && ['enrolled', 'expected'].includes(candidate.status))) return 'UNKNOWN';
  if (required.field) {
    if (!candidate.field) return 'UNKNOWN';
    const normalize = (v: string) => v.toLowerCase().replace(/\bcs\b/g, 'computer science').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!required.field.split(/,|\/|\bor\b/i).some((f) => normalize(f) === normalize(candidate.field!))) return required.relatedFieldsAllowed || required.equivalentAllowed ? 'UNKNOWN' : 'FAIL';
  }
  return actual >= needed ? 'PASS' : required.equivalentAllowed ? 'UNKNOWN' : 'FAIL';
}
function monthIndex(value: string, end: boolean): number | null {
  if (!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-\d{2})?)?$/.test(value)) return null;
  const [year, month = end ? 12 : 1, day = 1] = value.split('-').map(Number);
  return year! * 12 + month - 1 + (value.length <= 7 && end ? 1 : (day - 1) / new Date(Date.UTC(year!, month, 0)).getUTCDate());
}
export function unionMonths(intervals: { start: string | null; end: string | null; ongoing?: boolean | undefined }[], asOf: string): number {
  const now = monthIndex(asOf, false); if (now === null) return 0;
  const sorted = intervals.flatMap((i) => { if (!i.end && i.ongoing === false) return []; const start = i.start ? monthIndex(i.start, false) : null; const end = i.end ? monthIndex(i.end, true) : now; return start !== null && end !== null && end > start && start < now ? [[start, Math.min(end, now)] as [number, number]] : []; }).sort((a, b) => a[0] - b[0]);
  let total = 0; let right = -Infinity;
  for (const [start, end] of sorted) { if (end > right) total += end - Math.max(start, right); right = Math.max(end, right); }
  return Math.round(total * 1000) / 1000;
}
