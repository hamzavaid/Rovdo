import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CandidateProfileSchema, ImportPreviewSchema, IntelligenceSchema } from '@rovdo/shared';
import type { CandidateProfile, ImportPreview, Intelligence, ProfileFact } from '@rovdo/shared';
import { emptyProfile, intelligenceOf, resolveSkill, roleOf, SKILLS } from '@rovdo/career';
import { readPublic } from '@rovdo/shared/network';
import type { PublicResponse } from '@rovdo/shared/network';
export { extractFileText, zipEntries, csvRows } from './formats';
export const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const empty = (): Intelligence => ({ schemaVersion: 'intelligence-v2', evidence: [], skills: [], education: [], experience: [], projects: [], certifications: [] });
const sensitive = new Set(['citizenship', 'workAuthorization', 'clearance']);
function date(value: string): string | null {
  const iso = /\b(20\d{2}|19\d{2})(?:-(0[1-9]|1[0-2]))?\b/.exec(value);
  const words = /\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(19\d{2}|20\d{2})\b/i.exec(value);
  if (words) return `${words[2]}-${String(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(words[1]!.slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}`;
  return iso ? `${iso[1]}${iso[2] ? `-${iso[2]}` : ''}` : null;
}
function skillsIn(text: string, context: boolean) {
  return SKILLS.filter((s) => s.aliases.some((a) => (a.context === 'any' || context) && new RegExp(`(?:^|[^\\p{L}\\p{N}_])${a.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text)));
}
function resetVerification(intel: Intelligence): Intelligence {
  const result = structuredClone(intel); result.evidence.forEach((e) => { e.verified = false; });
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const) result[key].forEach((x) => { x.verified = false; });
  return result;
}
export function previewText(text: string, name: string, kind: ImportPreview['source']['kind'], capturedAt: string, format = 'txt'): ImportPreview {
  if (!text.trim() || text.length > 200000) throw new Error('TEXT_LIMIT');
  const hash = sha(text); const source = { id: `source:${hash}`, name: name.slice(0, 200), kind, format, sha256: hash, capturedAt };
  let intel = empty(); let facts: ProfileFact[] = []; const warnings: string[] = [];
  if (format === 'json') {
    const raw: unknown = JSON.parse(text);
    const structured = IntelligenceSchema.safeParse(raw);
    if (structured.success) intel = resetVerification(structured.data);
    else {
      const profile = CandidateProfileSchema.parse(raw);
      intel = resetVerification(intelligenceOf(profile));
      facts = profile.facts.map((f) => ({ ...f, id: `import:${hash.slice(0, 16)}:${f.id}`, verified: false }));
    }
    const scoped = (id: string) => `import:${hash.slice(0, 16)}:${sha(id).slice(0, 24)}`;
    intel.evidence.forEach((e) => { e.id = scoped(e.id); e.sourceId = source.id; e.sourceKind = kind; });
    for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const) intel[key].forEach((item) => { item.id = scoped(item.id); item.evidenceIds = item.evidenceIds.map(scoped); });
  } else {
    let section = '';
    const lines = text.normalize('NFKC').split(/\r?\n/).map((line) => line.replace(/^\s*[-#*]+\s*/, '').trim()).filter(Boolean);
    const bound = (line: string, confidence = .75) => {
      const id = `e:${sha(`${source.id}:${line}`).slice(0, 24)}`;
      if (!intel.evidence.some((e) => e.id === id)) intel.evidence.push({ id, sourceId: source.id, sourceKind: kind, excerpt: line.slice(0, 4000), sha256: sha(line), confidence, verified: false });
      return { id, evidenceIds: [id], verified: false };
    };
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (/^(skills|technical skills|technologies|education|experience|work experience|employment|positions|projects|certifications|profile)$/i.test(line)) { section = line.toLowerCase(); continue; }
      if (/^(gender|sex|birth|date of birth|ethnicity|religion|age|marital status)\b/i.test(line)) continue;
      const legal = /^(citizenship|work authorization|clearance)\s*:\s*(.+)$/i.exec(line);
      if (legal) {
        const field: ProfileFact['field'] = /citizen/i.test(legal[1]!) ? 'citizenship' : /clearance/i.test(legal[1]!) ? 'clearance' : 'workAuthorization';
        facts.push({ id: `fact:${sha(line).slice(0, 24)}`, field, value: legal[2]!.slice(0, 4000), verified: false, source: { kind: 'user', reference: `Unconfirmed import from ${name}`, capturedAt } }); continue;
      }
      const context = /skills|technolog|experience|positions|projects/.test(section);
      const found = skillsIn(line, context);
      for (const skill of found) if (!intel.skills.some((s) => s.skillId === skill.id)) {
        const b = bound(line); const version = new RegExp(`${skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+(?:\\.\\d+){0,2})`, 'i').exec(line)?.[1] ?? null;
        intel.skills.push({ ...b, id: `skill:${hash.slice(0, 16)}:${skill.id}`, skillId: skill.id, version, depth: /project/.test(section) ? 'project' : 'declared' });
      }
      if (/education/.test(section) || /\b(bachelor|master|bsc|msc|phd|associate)\b/i.test(line)) {
        const d = /bachelor|b\.?sc|b\.?s\.?\b|master|m\.?sc|doctorate|ph\.?d|associate/i.exec(line);
        if (d) {
          const b = bound(line); const degree = /bachelor|^b/i.test(d[0]) ? 'bachelor' : /master|^m/i.test(d[0]) ? 'master' : /associate/i.test(d[0]) ? 'associate' : 'doctorate';
          intel.education.push({ ...b, level: degree, field: /\bin\s+(.+?)(?:\s*\||,|\b(?:expected|completed|graduated)\b|$)/i.exec(line)?.[1]?.trim().slice(0, 4000) ?? '', institution: line.split('|')[1]?.trim() ?? '', status: /expected/i.test(line) ? 'expected' : /pursuing|enrolled|studying/i.test(line) ? 'enrolled' : /completed|graduated|earned/i.test(line) ? 'completed' : 'incomplete', graduation: date(line) });
        }
      }
      if (/experience|employment|positions/.test(section)) {
        const range = /((?:[A-Za-z]+\s+)?(?:19|20)\d{2}(?:-\d{2})?)\s*(?:-|–|—|to)\s*((?:[A-Za-z]+\s+)?(?:19|20)\d{2}(?:-\d{2})?|present|current)/i.exec(line);
        if (range) {
          const contextText = [line, ...lines.slice(index + 1, index + 3)].join('\n').slice(0, 4000); const b = bound(contextText); const title = line.split('|')[0]!.trim(); const role = roleOf(title);
          intel.experience.push({ ...b, title, organization: line.split('|')[1]?.trim() ?? '', roleFamily: role.family, level: role.level, track: role.track, start: date(range[1]!), end: /present|current/i.test(range[2]!) ? null : date(range[2]!), skills: skillsIn(contextText, true).map((s) => s.id), production: /production|deployed/i.test(contextText) });
        }
      }
      if (/projects/.test(section) || /^project:/i.test(line)) {
        const b = bound(line); const role = roleOf(`${line} software developer`);
        intel.projects.push({ ...b, name: line.replace(/^Project:\s*/i, '').split('|')[0]!.slice(0, 4000), description: line.slice(0, 4000), roleFamily: role.family, skills: found.map((s) => s.id), start: null, end: null, production: false, url: /https:\/\/[^\s|]+/.exec(line)?.[0] ?? null });
      }
      if (/certifications/.test(section) && !/clearance/i.test(line)) { const b = bound(line); intel.certifications.push({ ...b, name: line.split('|')[0]!.slice(0, 4000), issuer: line.split('|')[1]?.trim() ?? '', expires: date(line.split('|')[2] ?? ''), license: /licen[cs]e/i.test(line) }); }
    }
    if (!intel.education.length) warnings.push('No structured education identified. Add or edit it during review; no degree completion is inferred.');
    if (!intel.experience.length) warnings.push('No supported employment date ranges identified. Dates and duration remain unknown.');
  }
  warnings.push('All imported qualifications need explicit review. Repository metadata and document keywords do not prove authorship, employment or skill depth.');
  return ImportPreviewSchema.parse({ id: `import:${hash}`, parserVersion: 'profile-import-v1', status: 'ready', source, intelligence: intel, facts, warnings });
}
export function mergeReviewed(profile: CandidateProfile | null, input: ImportPreview, selectedIds: string[], confirmSensitive: boolean): CandidateProfile {
  const preview = ImportPreviewSchema.parse(input); if (preview.status !== 'ready') throw new Error('IMPORT_ALREADY_REVIEWED');
  const base = profile ?? emptyProfile(); const selected = new Set(selectedIds); const intel = intelligenceOf(base); const proposed = structuredClone(preview.intelligence);
  const selectedEvidence = new Set<string>();
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const) for (const item of proposed[key]) {
    item.verified = selected.has(item.id); if (item.verified) item.evidenceIds.forEach((id) => selectedEvidence.add(id));
  }
  proposed.evidence.forEach((e) => { e.verified = selectedEvidence.has(e.id); e.sourceId = preview.source.id; e.sourceKind = preview.source.kind; e.sha256 = sha(e.excerpt); });
  const existingEvidence = new Set(intel.evidence.map((e) => e.id));
  for (const e of proposed.evidence) if (!existingEvidence.has(e.id)) { intel.evidence.push(e); existingEvidence.add(e.id); }
  const keys = ['skills', 'education', 'experience', 'projects', 'certifications'] as const;
  for (const key of keys) {
    const identity = (x: (typeof intel)[typeof key][number]) => {
      if ('skillId' in x) return `${x.skillId}:${x.version ?? ''}`;
      if ('organization' in x) return `${x.title}:${x.organization}:${x.start}:${x.end}`.toLowerCase();
      if ('level' in x) return `${x.level}:${x.field}:${x.institution}:${x.graduation}`.toLowerCase();
      return `${x.name}:${'url' in x ? x.url ?? '' : x.issuer}`.toLowerCase();
    };
    // Keeping verified originals wins over conflicting imported representations.
    const target = intel[key] as (typeof intel)[typeof key][number][];
    for (const item of proposed[key]) if (selected.has(item.id)) {
      const index = target.findIndex((old) => identity(old) === identity(item));
      if (index < 0) target.push(item);
      else if (!target[index]!.verified) target[index] = item;
    }
  }
  const facts = [...base.facts];
  for (const f of preview.facts) if (selected.has(f.id)) {
    const verified = !sensitive.has(f.field) || confirmSensitive;
    const next = { ...f, verified, source: verified && sensitive.has(f.field) ? { kind: 'user' as const, reference: `Explicitly confirmed after import ${preview.source.name}`, capturedAt: preview.source.capturedAt } : f.source };
    if (!facts.some((old) => old.field === next.field && old.value.normalize('NFKC').trim().toLowerCase() === next.value.normalize('NFKC').trim().toLowerCase())) facts.push(next);
  }
  return CandidateProfileSchema.parse({ ...base, version: profile ? profile.version + 1 : 1, facts, intelligence: intel });
}

const RepositorySchema = z.looseObject({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), owner: z.object({ login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) }), private: z.literal(false), fork: z.boolean(), html_url: z.string().url(), description: z.string().nullable().optional(), stargazers_count: z.number().int().nonnegative(), topics: z.array(z.string()).optional() });
export async function githubPreview(username: string, limit: number, at: string, transport: (url: string) => Promise<PublicResponse> = readPublic): Promise<ImportPreview> {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_GITHUB');
  const get = async (path: string, allowMissing = false): Promise<unknown> => {
    const response = await transport(`https://api.github.com${path}`);
    if (allowMissing && response.status === 404) return null;
    if (response.status !== 200) throw new Error(response.status === 403 || response.status === 429 ? 'GITHUB_RATE_LIMITED' : 'GITHUB_UNAVAILABLE');
    if (response.body.length > 1_000_000) throw new Error('GITHUB_RESPONSE_LIMIT'); return JSON.parse(response.body.toString('utf8')) as unknown;
  };
  const raw = await get(`/users/${username}/repos?per_page=${limit}&sort=updated&type=owner`);
  const repositories = z.array(RepositorySchema).max(100).parse(raw).slice(0, limit); const intel = empty(); const snapshots: unknown[] = [];
  for (const repo of repositories) {
    const path = `/repos/${repo.owner.login}/${repo.name}`;
    const languages = z.record(z.string(), z.number().finite().nonnegative()).parse(await get(`${path}/languages`));
    const readme = await get(`${path}/readme`, true); const doc = readme === null ? '' : Buffer.from(z.object({ content: z.string().max(300000), encoding: z.literal('base64') }).parse(readme).content, 'base64').toString('utf8').slice(0, 16000);
    snapshots.push({ repo, languages, doc }); const excerpt = JSON.stringify({ url: repo.html_url, description: repo.description, languages, fork: repo.fork }).slice(0, 4000); const id = `github:${repo.owner.login}/${repo.name}`;
    intel.evidence.push({ id, sourceId: `github:${username}`, sourceKind: 'github', excerpt, sha256: sha(excerpt), confidence: .7, verified: false });
    const skills = Object.keys(languages).map((s) => resolveSkill(s, 'skill')).filter((s) => s !== null).map((s) => s.id);
    for (const skillId of skills) if (!intel.skills.some((s) => s.skillId === skillId)) intel.skills.push({ id: `github:skill:${skillId}`, skillId, version: null, evidenceIds: [id], verified: false, depth: 'project' });
    intel.projects.push({ id, name: repo.name, description: (repo.description ?? '').slice(0, 4000), roleFamily: 'unknown', skills, start: null, end: null, production: false, url: `https://github.com/${repo.owner.login}/${repo.name}`, evidenceIds: [id], verified: false, metadata: { fork: repo.fork, stars: repo.stargazers_count, languages, documentation: doc, ownership: 'unconfirmed' } });
  }
  const hash = sha(JSON.stringify(snapshots));
  return ImportPreviewSchema.parse({ id: `import:${hash}`, parserVersion: 'profile-import-v1', status: 'ready', source: { id: `github:${username}`, name: `GitHub ${username}`, kind: 'github', format: 'github-rest', sha256: hash, capturedAt: at }, intelligence: intel, facts: [], warnings: ['Public metadata does not establish authorship, individual contribution, proficiency or professional duration. Forks, stars and repository timestamps do not enter the technical score.'] });
}
