import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { AiReviewSchema, CandidateProfileSchema, JobMatchSchema, JobSchema, SourceConfigSchema, SourceStateSchema } from '@rovdo/shared';
import type { AiReview, CandidateProfile, Job, JobMatch, ProfileFact, SourceConfig, SourceState, SourceView } from '@rovdo/shared';
import { RankingProfileSchema } from '@rovdo/shared';
import type { RankingProfile } from '@rovdo/shared';
import { BUILTIN_RANKINGS, extractRequirements } from '@rovdo/career';
import { ImportPreviewSchema } from '@rovdo/shared';
import type { ImportPreview } from '@rovdo/shared';

const initialState = (): SourceState => ({ status: 'NEVER_POLLED', cursor: null, pollId: null, etag: null, lastModified: null, lastPollAt: null, lastSuccessAt: null, nextPollAt: 0, failures: 0, responseStatus: null, returned: 0, parsed: 0, rejected: 0, duplicates: 0, accepted: 0, requests: 0, durationMs: 0, error: null, parserVersion: 'ats-v1' });
const normalized = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const signature = (j: Job) => createHash('sha256').update([j.company, j.title, j.location, (j.postedAt ?? '').slice(0, 4)].map(normalized).join('|')).digest('hex');
export class CareerStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS career_schema (version INTEGER PRIMARY KEY);');
    const version = Number(this.db.prepare('SELECT COALESCE(MAX(version),0) AS n FROM career_schema').get()!.n);
    if (version > 3) throw new Error('DATABASE_TOO_NEW');
    if (!version) this.transaction(() => {
      this.db.exec(`
        CREATE TABLE candidate_profile (version INTEGER PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE job_source (id TEXT PRIMARY KEY, config TEXT NOT NULL, state TEXT NOT NULL);
        CREATE TABLE career_job (id TEXT PRIMARY KEY, canonical TEXT NOT NULL UNIQUE, company TEXT NOT NULL, requisition TEXT, signature TEXT NOT NULL, json TEXT NOT NULL);
        CREATE INDEX job_requisition ON career_job(company,requisition);
        CREATE INDEX job_signature ON career_job(signature);
        CREATE VIRTUAL TABLE job_fts USING fts5(title,keywords,description,tokenize='unicode61');
        CREATE TABLE job_source_snapshot (source_id TEXT NOT NULL REFERENCES job_source(id), source_key TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES career_job(id), poll_id TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0, raw_hash TEXT NOT NULL, PRIMARY KEY(source_id,source_key));
        CREATE TABLE job_match (job_id TEXT NOT NULL REFERENCES career_job(id), profile_version INTEGER NOT NULL, scorer_version TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(job_id,profile_version,scorer_version));
        CREATE TABLE saved_opportunity (job_id TEXT PRIMARY KEY REFERENCES career_job(id), saved_at INTEGER NOT NULL);
        CREATE TABLE source_origin_quota (origin TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
        CREATE TABLE job_search_run (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, metrics TEXT NOT NULL);
        CREATE TABLE job_ai_review (cache_key TEXT PRIMARY KEY, json TEXT NOT NULL);
        INSERT INTO career_schema VALUES(1);`);
    });
    if (version < 2) this.transaction(() => {
      this.db.exec(`
        CREATE TABLE ranking_profile (id TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(id,revision));
        CREATE TABLE ranking_profile_deleted (id TEXT PRIMARY KEY);
        CREATE TABLE career_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE ranking_snapshot (cache_key TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES career_job(id), json TEXT NOT NULL);
        CREATE TABLE job_requirements_v2 (job_id TEXT NOT NULL REFERENCES career_job(id), content_hash TEXT NOT NULL, parser_version TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(job_id,content_hash,parser_version));
        INSERT INTO career_schema VALUES(2);`);
    });
    if (version < 3) this.transaction(() => { this.db.exec('CREATE TABLE profile_import (id TEXT PRIMARY KEY, json TEXT NOT NULL); INSERT INTO career_schema VALUES(3);'); });
    // An interrupted page keeps its cursor and completed rows; no disappearance
    // decision is made until a complete authoritative snapshot succeeds.
    for (const source of this.sources()) if (source.state.status === 'POLLING') this.setState(source.config.id, { ...source.state, status: 'INTERRUPTED', nextPollAt: 0 });
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE'); try { const value = work(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  profile(): CandidateProfile | null { const row = this.db.prepare('SELECT json FROM candidate_profile ORDER BY version DESC LIMIT 1').get(); return row ? CandidateProfileSchema.parse(JSON.parse(String(row.json))) : null; }
  rankings(): RankingProfile[] {
    const custom = this.db.prepare('SELECT p.json FROM ranking_profile p WHERE p.revision=(SELECT MAX(q.revision) FROM ranking_profile q WHERE q.id=p.id) AND NOT EXISTS(SELECT 1 FROM ranking_profile_deleted d WHERE d.id=p.id) ORDER BY p.id').all().map((r) => RankingProfileSchema.parse(JSON.parse(String(r.json))));
    return [...BUILTIN_RANKINGS, ...custom];
  }
  cloneRanking(id: string, name: string): RankingProfile {
    const base = this.rankings().find((p) => p.id === id); if (!base) throw new Error('RANKING_NOT_FOUND');
    const clone = RankingProfileSchema.parse({ ...base, id: randomUUID(), name, revision: 1 });
    this.db.prepare('INSERT INTO ranking_profile VALUES(?,?,?)').run(clone.id, clone.revision, JSON.stringify(clone)); return clone;
  }
  saveRanking(input: unknown): void {
    const parsed = RankingProfileSchema.parse(input); if (parsed.id.startsWith('builtin:')) throw new Error('BUILTIN_IMMUTABLE');
    this.transaction(() => { const old = this.rankings().find((p) => p.id === parsed.id); if (!old || parsed.revision !== old.revision + 1) throw new Error('RANKING_REVISION_CONFLICT'); this.db.prepare('INSERT INTO ranking_profile VALUES(?,?,?)').run(parsed.id, parsed.revision, JSON.stringify(parsed)); });
  }
  deleteRanking(id: string): void {
    if (id.startsWith('builtin:') || !this.rankings().some((p) => p.id === id)) throw new Error('RANKING_NOT_FOUND');
    this.transaction(() => { this.db.prepare('INSERT INTO ranking_profile_deleted VALUES(?)').run(id); if (this.defaultRanking() === id) this.setDefaultRanking('builtin:legacy-v1'); });
  }
  defaultRanking(): string { return String(this.db.prepare("SELECT value FROM career_setting WHERE key='ranking-default'").get()?.value ?? 'builtin:legacy-v1'); }
  setDefaultRanking(id: string): void { if (!this.rankings().some((p) => p.id === id)) throw new Error('RANKING_NOT_FOUND'); this.db.prepare("INSERT INTO career_setting VALUES('ranking-default',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id); }
  importPreviews(): ImportPreview[] { return this.db.prepare('SELECT json FROM profile_import ORDER BY rowid DESC LIMIT 20').all().map((r) => ImportPreviewSchema.parse(JSON.parse(String(r.json)))); }
  importPreview(id: string): ImportPreview { const row = this.db.prepare('SELECT json FROM profile_import WHERE id=?').get(id); if (!row) throw new Error('IMPORT_NOT_FOUND'); return ImportPreviewSchema.parse(JSON.parse(String(row.json))); }
  saveImport(input: ImportPreview): void { const preview = ImportPreviewSchema.parse(input); this.db.prepare('INSERT INTO profile_import VALUES(?,?) ON CONFLICT DO NOTHING').run(preview.id, JSON.stringify(preview)); }
  rejectImport(id: string): void { const old = this.importPreview(id); if (old.status !== 'ready') throw new Error('IMPORT_ALREADY_REVIEWED'); this.db.prepare('UPDATE profile_import SET json=? WHERE id=?').run(JSON.stringify({ ...old, status: 'rejected' }), id); }
  commitImport(id: string, input: CandidateProfile): void {
    const profile = CandidateProfileSchema.parse(input);
    this.transaction(() => { const preview = this.importPreview(id); if (preview.status !== 'ready' || profile.version !== (this.profile()?.version ?? 0) + 1) throw new Error('IMPORT_VERSION_CONFLICT'); this.db.prepare('INSERT INTO candidate_profile VALUES(?,?)').run(profile.version, JSON.stringify(profile)); this.db.prepare('UPDATE profile_import SET json=? WHERE id=?').run(JSON.stringify({ ...preview, status: 'accepted' }), id); });
  }
  recordRanking(match: JobMatch): void {
    const data = JobMatchSchema.parse(match); if (!data.ranking) throw new Error('RANKING_METADATA_REQUIRED');
    const key = createHash('sha256').update(JSON.stringify([data.job.id, data.job.contentSha256, data.profileVersion, data.ranking])).digest('hex');
    this.db.prepare('INSERT INTO ranking_snapshot VALUES(?,?,?) ON CONFLICT DO NOTHING').run(key, data.job.id, JSON.stringify(data));
    if (data.ranking.method !== 'legacy-v1') {
      const requirements = extractRequirements(data.job.descriptionText, data.job.title);
      this.db.prepare('INSERT INTO job_requirements_v2 VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(data.job.id, data.job.contentSha256, requirements.parserVersion, JSON.stringify(requirements));
    }
  }
  saveProfile(input: unknown): void {
    const profile = CandidateProfileSchema.parse(input);
    this.transaction(() => { const previous = this.profile(); if (profile.version !== (previous?.version ?? 0) + 1) throw new Error('PROFILE_VERSION_CONFLICT'); this.db.prepare('INSERT INTO candidate_profile VALUES (?,?)').run(profile.version, JSON.stringify(profile)); });
  }
  proposeFacts(facts: ProfileFact[]): void {
    const previous = this.profile(); if (!previous) throw new Error('PROFILE_REQUIRED');
    const known = new Set(previous.facts.map((f) => f.id));
    this.saveProfile({ ...previous, version: previous.version + 1, facts: [...previous.facts, ...facts.filter((f) => !known.has(f.id)).map((f) => ({ ...f, verified: false }))] });
  }
  saveSource(input: unknown): void {
    const config = SourceConfigSchema.parse(input); const old = this.sources().find((s) => s.config.id === config.id);
    if (this.sources().some((s) => s.config.id !== config.id && s.config.ats === config.ats && s.config.tenant === config.tenant && s.config.region === config.region)) throw new Error('DUPLICATE_SOURCE');
    if (old && ['ats', 'tenant', 'region', 'company'].some((key) => old.config[key as keyof SourceConfig] !== config[key as keyof SourceConfig])) throw new Error('SOURCE_IDENTITY_IMMUTABLE');
    const state = old?.state ?? initialState(); if (!config.enabled) state.status = 'DISABLED'; else if (state.status === 'DISABLED') { state.status = 'NEVER_POLLED'; state.nextPollAt = 0; }
    this.db.prepare('INSERT INTO job_source VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,state=excluded.state').run(config.id, JSON.stringify(config), JSON.stringify(state));
  }
  sources(): SourceView[] { return this.db.prepare('SELECT config,state FROM job_source ORDER BY id').all().map((r) => ({ config: SourceConfigSchema.parse(JSON.parse(String(r.config))), state: SourceStateSchema.parse(JSON.parse(String(r.state))) })); }
  setState(id: string, input: SourceState): void { const state = SourceStateSchema.parse(input); this.db.prepare('UPDATE job_source SET state=? WHERE id=?').run(JSON.stringify(state), id); }
  originReady(origin: string): number { return Number(this.db.prepare('SELECT next_at FROM source_origin_quota WHERE origin=?').get(origin)?.next_at ?? 0); }
  reserveOrigin(origin: string, now: number): number { return this.transaction(() => { const at = Math.max(now, this.originReady(origin)); this.db.prepare('INSERT INTO source_origin_quota VALUES(?,?) ON CONFLICT(origin) DO UPDATE SET next_at=excluded.next_at').run(origin, at + 1000); return at; }); }
  deferOrigin(origin: string, until: number): void { this.db.prepare('INSERT INTO source_origin_quota VALUES(?,?) ON CONFLICT(origin) DO UPDATE SET next_at=MAX(next_at,excluded.next_at)').run(origin, until); }
  private writeJob(job: Job): void {
    JobSchema.parse(job);
    this.db.prepare('INSERT INTO career_job VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical=excluded.canonical,company=excluded.company,requisition=excluded.requisition,signature=excluded.signature,json=excluded.json').run(job.id, job.canonicalUrl, normalized(job.company), job.requisitionId, signature(job), JSON.stringify(job));
    const rowid = Number(this.db.prepare('SELECT rowid FROM career_job WHERE id=?').get(job.id)!.rowid);
    this.db.prepare('DELETE FROM job_fts WHERE rowid=?').run(rowid);
    this.db.prepare('INSERT INTO job_fts(rowid,title,keywords,description) VALUES(?,?,?,?)').run(rowid, job.title, job.descriptionText.match(/\b(?:TypeScript|JavaScript|Python|Rust|SQL|Java|React|Go|C\+\+)\b/gi)?.join(' ') ?? '', job.descriptionText);
  }
  batch(source: SourceConfig, jobs: Job[], state: SourceState, pollId: string, complete: boolean, now: number): void {
    this.transaction(() => {
      for (const raw of jobs) {
        const key = raw.id;
        const membership = this.db.prepare('SELECT job_id FROM job_source_snapshot WHERE source_id=? AND source_key=?').get(source.id, key);
        const row = membership ? this.db.prepare('SELECT json FROM career_job WHERE id=?').get(String(membership.job_id)) : this.db.prepare('SELECT json FROM career_job WHERE canonical=? OR (company=? AND requisition IS NOT NULL AND requisition=?) LIMIT 1').get(raw.canonicalUrl, normalized(raw.company), raw.requisitionId);
        const old = row ? JobSchema.parse(JSON.parse(String(row.json))) : null;
        const provenance = { ...raw.provenance[0]!, collectedAt: now };
        let job: Job = { ...raw, firstSeenAt: old?.firstSeenAt ?? now, lastSeenAt: now, provenance: old ? [...old.provenance.filter((p) => p.sourceKey !== key), provenance].slice(-100) : [provenance], id: old?.id ?? raw.id };
        if (old && normalized(old.company) !== normalized(raw.company)) job = { ...old, duplicateGroup: 'EMPLOYER_CONFLICT', provenance: job.provenance };
        else if (old && old.source !== raw.source) job = { ...old, lastSeenAt: now, activeStatus: 'open', provenance: job.provenance }; // Never overwrite first-party fields with a second source.
        if (old) state.duplicates++; else state.accepted++;
        this.writeJob(job);
        this.db.prepare('INSERT INTO job_source_snapshot VALUES(?,?,?,?,0,?) ON CONFLICT(source_id,source_key) DO UPDATE SET job_id=excluded.job_id,poll_id=excluded.poll_id,missing=0,raw_hash=excluded.raw_hash').run(source.id, key, job.id, pollId, raw.rawSha256);
        const possible = this.db.prepare('SELECT json FROM career_job WHERE signature=? AND id<>?').all(signature(job), job.id);
        for (const r of possible) { const other = JobSchema.parse(JSON.parse(String(r.json))); this.writeJob({ ...other, duplicateGroup: signature(job) }); job.duplicateGroup = signature(job); }
        if (possible.length) this.writeJob(job);
      }
      if (complete) {
        this.db.prepare('UPDATE job_source_snapshot SET missing=missing+1 WHERE source_id=? AND poll_id<>?').run(source.id, pollId);
        const missing = this.db.prepare('SELECT DISTINCT job_id FROM job_source_snapshot WHERE source_id=? AND missing>=?').all(source.id, source.missingGracePolls);
        for (const r of missing) {
          const active = this.db.prepare('SELECT COUNT(*) AS n FROM job_source_snapshot ss JOIN job_source s ON ss.source_id=s.id WHERE ss.job_id=? AND ss.missing<?').get(String(r.job_id), source.missingGracePolls);
          if (Number(active!.n) === 0) { const job = this.job(String(r.job_id)); this.writeJob({ ...job, activeStatus: 'unknown' }); }
        }
      }
      this.setState(source.id, state);
    });
  }
  audit(sourceId: string, state: SourceState): void { this.db.prepare('INSERT INTO job_search_run VALUES(?,?,?)').run(randomUUID(), sourceId, JSON.stringify(state)); this.db.exec('DELETE FROM job_search_run WHERE rowid NOT IN (SELECT rowid FROM job_search_run ORDER BY rowid DESC LIMIT 1000)'); }
  jobs(): Job[] { return this.db.prepare('SELECT json FROM career_job ORDER BY id').all().map((r) => JobSchema.parse(JSON.parse(String(r.json)))); }
  job(id: string): Job { const row = this.db.prepare('SELECT json FROM career_job WHERE id=?').get(id); if (!row) throw new Error('JOB_NOT_FOUND'); return JobSchema.parse(JSON.parse(String(row.json))); }
  search(query: string): { job: Job; bm25Raw: number }[] {
    const words = query.match(/[\p{L}\p{N}_+#.-]+/gu)?.slice(0, 30) ?? [];
    const expression = words.map((w) => `"${w.replaceAll('"', '""')}"`).join(' OR ');
    if (!expression) return this.jobs().map((job) => ({ job, bm25Raw: 0 }));
    return this.db.prepare('SELECT j.json,bm25(job_fts,4,2,1) AS rank FROM job_fts JOIN career_job j ON j.rowid=job_fts.rowid WHERE job_fts MATCH ? ORDER BY rank,j.id').all(expression).map((r) => ({ job: JobSchema.parse(JSON.parse(String(r.json))), bm25Raw: Number(r.rank) }));
  }
  saveMatches(matches: JobMatch[]): void { this.transaction(() => { for (const m of matches) { JobMatchSchema.parse(m); this.db.prepare('INSERT INTO job_match VALUES(?,?,?,?) ON CONFLICT(job_id,profile_version,scorer_version) DO UPDATE SET json=excluded.json WHERE job_match.json<>excluded.json').run(m.job.id, m.profileVersion, m.scorerVersion, JSON.stringify(m)); } }); }
  saveJob(id: string, saved: boolean): void { this.job(id); if (saved) this.db.prepare('INSERT INTO saved_opportunity VALUES(?,?) ON CONFLICT DO NOTHING').run(id, Date.now()); else this.db.prepare('DELETE FROM saved_opportunity WHERE job_id=?').run(id); }
  savedIds(): string[] { return this.db.prepare('SELECT job_id FROM saved_opportunity ORDER BY job_id').all().map((r) => String(r.job_id)); }
  review(key: string): AiReview | null { const r = this.db.prepare('SELECT json FROM job_ai_review WHERE cache_key=?').get(key); return r ? AiReviewSchema.parse(JSON.parse(String(r.json))) : null; }
  saveReview(key: string, review: AiReview): void { AiReviewSchema.parse(review); this.db.prepare('INSERT INTO job_ai_review VALUES(?,?) ON CONFLICT(cache_key) DO UPDATE SET json=excluded.json').run(key, JSON.stringify(review)); }
  reviews(): AiReview[] { return this.db.prepare('SELECT json FROM job_ai_review ORDER BY rowid DESC LIMIT 100').all().map((r) => AiReviewSchema.parse(JSON.parse(String(r.json)))); }
  close(): void { this.db.close(); }
}
