/**
 * Deterministic import entry points, reviewed merges and public GitHub project evidence.
 * All imported material starts unverified; compatible reimports link evidence without replacing verified originals.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CandidateProfileSchema,
  ImportPreviewSchema,
  IntelligenceSchema,
  ImportFailure,
} from '@rovdo/shared';
import type { CandidateProfile, ImportPreview, Intelligence, ProfileFact } from '@rovdo/shared';
import {
  emptyProfile,
  intelligenceOf,
  qualificationsConflict,
  resolveSkill,
  SKILLS,
} from '@rovdo/career';
import { readPublic } from '@rovdo/shared/network';
import type { PublicResponse } from '@rovdo/shared/network';
export { zipEntries, csvRows } from './formats';
export { extractFileText, extractDocument, pdfBlocks } from './document';
export { previewDocument } from './parser';
import { textDocument } from './document';
import { previewDocument, qualificationIdentity, recognizedSkills } from './parser';
export const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const empty = (): Intelligence => ({
  schemaVersion: 'intelligence-v2',
  evidence: [],
  skills: [],
  education: [],
  experience: [],
  projects: [],
  certifications: [],
});
const sensitive = new Set(['citizenship', 'workAuthorization', 'clearance']);
function skillsIn(text: string, context: boolean) {
  return recognizedSkills(text, context)
    .map((id) => SKILLS.find((s) => s.id === id)!)
    .filter(Boolean);
}
function resetVerification(intel: Intelligence): Intelligence {
  const result = structuredClone(intel);
  result.evidence.forEach((e) => {
    e.verified = false;
  });
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const)
    result[key].forEach((x) => {
      x.verified = false;
    });
  return result;
}
export function previewText(
  text: string,
  name: string,
  kind: ImportPreview['source']['kind'],
  capturedAt: string,
  format = 'txt',
): ImportPreview {
  if (!text.trim() || text.length > 200000) throw new Error('TEXT_LIMIT');
  const hash = sha(text);
  const source = {
    id: `source:${hash}`,
    name: name.slice(0, 200),
    kind,
    format,
    sha256: hash,
    capturedAt,
  };
  let intel: Intelligence;
  let facts: ProfileFact[] = [];
  const warnings: string[] = [];
  if (format === 'json') {
    const raw: unknown = JSON.parse(text);
    const structured = IntelligenceSchema.safeParse(raw);
    if (structured.success) intel = resetVerification(structured.data);
    else {
      const profile = CandidateProfileSchema.parse(raw);
      intel = resetVerification(intelligenceOf(profile));
      facts = profile.facts.map((f) => ({
        ...f,
        id: `import:${hash.slice(0, 16)}:${f.id}`,
        verified: false,
      }));
    }
    const scoped = (id: string) => `import:${hash.slice(0, 16)}:${sha(id).slice(0, 24)}`;
    intel.evidence.forEach((e) => {
      e.id = scoped(e.id);
      e.sourceId = source.id;
      e.sourceKind = kind;
    });
    for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const)
      intel[key].forEach((item) => {
        item.id = scoped(item.id);
        item.evidenceIds = item.evidenceIds.map(scoped);
      });
  } else return previewDocument(textDocument(text, format), name, kind, capturedAt);
  warnings.push(
    'All imported qualifications need explicit review. Repository metadata and document keywords do not prove authorship, employment or skill depth.',
  );
  return ImportPreviewSchema.parse({
    id: `import:${hash}`,
    parserVersion: 'profile-import-v2',
    status: 'ready',
    source,
    intelligence: intel,
    facts,
    warnings,
  });
}
/** Merge only selected proposals; preserve verified originals and commit a new profile version. */
export function mergeReviewed(
  profile: CandidateProfile | null,
  input: ImportPreview,
  selectedIds: string[],
  confirmSensitive: boolean,
): CandidateProfile {
  const preview = ImportPreviewSchema.parse(input);
  if (preview.status !== 'ready') throw new Error('IMPORT_ALREADY_REVIEWED');
  const base = profile ?? emptyProfile();
  const selected = new Set(selectedIds);
  const intel = intelligenceOf(base);
  const proposed = structuredClone(preview.intelligence);
  // Source conflicts require an explicit consistent choice; accepting both would blend incompatible claims.
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const) {
    const chosen = proposed[key].filter((q) => selected.has(q.id));
    if (chosen.some((a, i) => chosen.slice(i + 1).some((b) => qualificationsConflict(a, b))))
      throw new ImportFailure('IMPORT_CONFLICT');
    for (const q of chosen) delete q.conflictWith;
  }
  const selectedEvidence = new Set<string>();
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications'] as const)
    for (const item of proposed[key]) {
      item.verified = selected.has(item.id);
      if (item.verified) item.evidenceIds.forEach((id) => selectedEvidence.add(id));
    }
  // Review approves source support for selected records only; unselected import content stays unverified.
  proposed.evidence.forEach((e) => {
    e.verified = selectedEvidence.has(e.id);
    e.sourceId = preview.source.id;
    e.sourceKind = preview.source.kind;
    e.sha256 = sha(e.excerpt);
  });
  const existingEvidence = new Set(intel.evidence.map((e) => e.id));
  for (const e of proposed.evidence) {
    if (!existingEvidence.has(e.id)) {
      intel.evidence.push(e);
      existingEvidence.add(e.id);
    } else {
      const old = intel.evidence.find((old) => old.id === e.id)!;
      if (e.verified && old.sha256 === e.sha256) old.verified = true;
    }
  }
  const keys = ['skills', 'education', 'experience', 'projects', 'certifications'] as const;
  for (const key of keys) {
    const identity = qualificationIdentity;
    // Keeping verified originals wins over conflicting imported representations.
    const target = intel[key] as (typeof intel)[typeof key][number][];
    for (const item of proposed[key])
      if (selected.has(item.id)) {
        const index = target.findIndex((old) => identity(old) === identity(item));
        if (index < 0) target.push(item);
        else {
          const old = target[index]!;
          if (old.verified && qualificationsConflict(old, item)) continue;
          const refs = [...new Set([...old.evidenceIds, ...item.evidenceIds])].slice(0, 50);
          if (!old.verified) target[index] = { ...item, id: old.id, evidenceIds: refs };
          else old.evidenceIds = refs;
        }
      }
  }
  const facts = [...base.facts];
  for (const f of preview.facts)
    if (selected.has(f.id)) {
      const verified = !sensitive.has(f.field) || confirmSensitive;
      const next = {
        ...f,
        verified,
        source:
          verified && sensitive.has(f.field)
            ? {
                kind: 'user' as const,
                reference: `Explicitly confirmed after import ${preview.source.name}`,
                capturedAt: preview.source.capturedAt,
              }
            : f.source,
      };
      if (
        !facts.some(
          (old) =>
            old.field === next.field &&
            old.value.normalize('NFKC').trim().toLowerCase() ===
              next.value.normalize('NFKC').trim().toLowerCase(),
        )
      )
        facts.push(next);
    }
  return CandidateProfileSchema.parse({
    ...base,
    version: profile ? profile.version + 1 : 1,
    facts,
    intelligence: intel,
  });
}

const RepositorySchema = z.looseObject({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  owner: z.object({ login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) }),
  private: z.literal(false),
  fork: z.boolean(),
  html_url: z.string().url(),
  description: z.string().nullable().optional(),
  stargazers_count: z.number().int().nonnegative(),
  topics: z.array(z.string()).optional(),
});
/** Read bounded public repository metadata/documentation; popularity and timestamps never prove expertise. */
export async function githubPreview(
  username: string,
  limit: number,
  at: string,
  transport: (url: string) => Promise<PublicResponse> = readPublic,
): Promise<ImportPreview> {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw new Error('INVALID_GITHUB');
  const get = async (path: string, allowMissing = false): Promise<unknown> => {
    const response = await transport(`https://api.github.com${path}`);
    if (allowMissing && response.status === 404) return null;
    if (response.status !== 200)
      throw new Error(
        response.status === 403 || response.status === 429
          ? 'GITHUB_RATE_LIMITED'
          : 'GITHUB_UNAVAILABLE',
      );
    if (response.body.length > 1_000_000) throw new Error('GITHUB_RESPONSE_LIMIT');
    return JSON.parse(response.body.toString('utf8')) as unknown;
  };
  const raw = await get(`/users/${username}/repos?per_page=${limit}&sort=updated&type=owner`);
  const repositories = z.array(RepositorySchema).max(100).parse(raw).slice(0, limit);
  const intel = empty();
  const snapshots: unknown[] = [];
  for (const repo of repositories) {
    const path = `/repos/${repo.owner.login}/${repo.name}`;
    const languages = z
      .record(z.string(), z.number().finite().nonnegative())
      .parse(await get(`${path}/languages`));
    const readme = await get(`${path}/readme`, true);
    const doc =
      readme === null
        ? ''
        : Buffer.from(
            z
              .object({ content: z.string().max(300000), encoding: z.literal('base64') })
              .parse(readme).content,
            'base64',
          )
            .toString('utf8')
            .slice(0, 16000);
    snapshots.push({ repo, languages, doc });
    const excerpt = JSON.stringify({
      url: repo.html_url,
      description: repo.description,
      languages,
      fork: repo.fork,
    }).slice(0, 4000);
    const id = `github:${repo.owner.login}/${repo.name}`;
    intel.evidence.push({
      id,
      sourceId: `github:${username}`,
      sourceKind: 'github',
      excerpt,
      sha256: sha(excerpt),
      confidence: 0.7,
      verified: false,
    });
    const languageIds = Object.keys(languages)
      .map((s) => resolveSkill(s, 'skill'))
      .filter((s) => s !== null)
      .map((s) => s.id);
    const documentation = `${repo.description ?? ''}\n${doc}`.split(/\r?\n/).map((line) => ({
      line,
      skills: skillsIn(line, /skills|technolog|stack|\buses\b|written|built/i.test(line)),
    }));
    const skills = [
      ...new Set([...languageIds, ...documentation.flatMap((d) => d.skills.map((s) => s.id))]),
    ];
    for (const skillId of skills) {
      let evidenceId = id;
      if (!languageIds.includes(skillId)) {
        const excerpt = documentation
          .find((d) => d.skills.some((s) => s.id === skillId))!
          .line.slice(0, 4000);
        evidenceId = `${id}:${skillId}`;
        intel.evidence.push({
          id: evidenceId,
          sourceId: `github:${username}`,
          sourceKind: 'github',
          excerpt,
          sha256: sha(excerpt),
          confidence: 0.55,
          verified: false,
        });
      }
      const existing = intel.skills.find((s) => s.skillId === skillId);
      if (existing) existing.evidenceIds = [...new Set([...existing.evidenceIds, evidenceId])];
      else
        intel.skills.push({
          id: `github:skill:${skillId}`,
          skillId,
          version: null,
          evidenceIds: [evidenceId],
          verified: false,
          depth: 'project',
          recognition: 'contextual',
        });
    }
    intel.projects.push({
      id,
      name: repo.name,
      description: (repo.description ?? '').slice(0, 4000),
      roleFamily: 'unknown',
      skills,
      start: null,
      end: null,
      production: false,
      url: `https://github.com/${repo.owner.login}/${repo.name}`,
      evidenceIds: [id],
      verified: false,
      metadata: {
        fork: repo.fork,
        stars: repo.stargazers_count,
        languages,
        documentation: doc,
        ownership: 'unconfirmed',
      },
    });
  }
  const hash = sha(JSON.stringify(snapshots));
  return ImportPreviewSchema.parse({
    id: `import:${hash}`,
    parserVersion: 'profile-import-v2',
    status: 'ready',
    source: {
      id: `github:${username}`,
      name: `GitHub ${username}`,
      kind: 'github',
      format: 'github-rest',
      sha256: hash,
      capturedAt: at,
    },
    intelligence: intel,
    facts: [],
    warnings: [
      'Public metadata does not establish authorship, individual contribution, proficiency or professional duration. Forks, stars and repository timestamps do not enter the technical score.',
    ],
  });
}
