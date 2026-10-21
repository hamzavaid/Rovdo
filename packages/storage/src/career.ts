import { DiscoveryStore } from './discovery';
/**
 * SQLite career persistence: profile history, jobs, sources, imports, ranking revisions and search caches.
 * Additive migrations and transactions preserve historical data; cache keys bind scoring inputs and policy versions.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  AiReviewSchema,
  CandidateProfileSchema,
  JobMatchSchema,
  JobSchema,
  SourceConfigSchema,
  SourceStateSchema,
} from '@rovdo/shared';
import type {
  AiReview,
  CandidateProfile,
  Job,
  JobMatch,
  ProfileFact,
  SourceConfig,
  SourceState,
  SourceView,
} from '@rovdo/shared';
import { RankingProfileSchema } from '@rovdo/shared';
import type { RankingProfile } from '@rovdo/shared';
import {
  SCORING_POLICY_VERSION,
  CANDIDATE_POLICY_VERSION,
  TAXONOMY_VERSION,
  REQUIREMENTS_PARSER_VERSION,
  BUILTIN_RANKINGS,
  extractRequirements,
  stable,
  intelligenceOf,
  rankWithProfile,
  roleOf,
} from '@rovdo/career';
import { EmployerSchema, JobSearchSchema, JobMarkerSchema, SavedSearchSchema } from '@rovdo/shared';
import type { Employer, JobSearch, JobMarker, SavedSearch } from '@rovdo/shared';
import { ImportPreviewSchema } from '@rovdo/shared';
import type { ImportPreview } from '@rovdo/shared';

const initialState = (): SourceState => ({
  status: 'NEVER_POLLED',
  cursor: null,
  pollId: null,
  etag: null,
  lastModified: null,
  lastPollAt: null,
  lastSuccessAt: null,
  nextPollAt: 0,
  failures: 0,
  responseStatus: null,
  returned: 0,
  parsed: 0,
  rejected: 0,
  duplicates: 0,
  accepted: 0,
  requests: 0,
  durationMs: 0,
  error: null,
  parserVersion: 'ats-v1',
});
const normalized = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const signature = (j: Job) =>
  createHash('sha256')
    .update(
      [j.company, j.title, j.location, (j.postedAt ?? '').slice(0, 4)].map(normalized).join('|'),
    )
    .digest('hex');
export class CareerStore {
  private readonly db: DatabaseSync;
  readonly global: DiscoveryStore;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS career_schema (version INTEGER PRIMARY KEY);',
    );
    // Apply additive versions atomically and refuse a newer schema rather than trying to downgrade user data.
    const version = Number(
      this.db.prepare('SELECT COALESCE(MAX(version),0) AS n FROM career_schema').get()!.n,
    );
    if (version > 5) throw new Error('DATABASE_TOO_NEW');
    if (!version)
      this.transaction(() => {
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
    if (version < 2)
      this.transaction(() => {
        this.db.exec(`
        CREATE TABLE ranking_profile (id TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(id,revision));
        CREATE TABLE ranking_profile_deleted (id TEXT PRIMARY KEY);
        CREATE TABLE career_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE ranking_snapshot (cache_key TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES career_job(id), json TEXT NOT NULL);
        CREATE TABLE job_requirements_v2 (job_id TEXT NOT NULL REFERENCES career_job(id), content_hash TEXT NOT NULL, parser_version TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(job_id,content_hash,parser_version));
        INSERT INTO career_schema VALUES(2);`);
      });
    if (version < 3)
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE profile_import (id TEXT PRIMARY KEY, json TEXT NOT NULL); INSERT INTO career_schema VALUES(3);',
        );
      });
    if (version < 4)
      this.transaction(() => {
        this.db.exec(`CREATE TABLE employer_directory(id TEXT PRIMARY KEY,json TEXT NOT NULL);
        CREATE TABLE employer_alias(alias TEXT PRIMARY KEY,company_id TEXT NOT NULL);
        CREATE TABLE source_record(source_id TEXT NOT NULL,source_key TEXT NOT NULL,job_id TEXT NOT NULL REFERENCES career_job(id),json TEXT NOT NULL,PRIMARY KEY(source_id,source_key));
        CREATE TABLE source_quarantine(source_id TEXT NOT NULL,hash TEXT NOT NULL,code TEXT NOT NULL,observed_at INTEGER NOT NULL,PRIMARY KEY(source_id,hash));
        CREATE TABLE saved_search(id TEXT PRIMARY KEY,json TEXT NOT NULL);
        CREATE TABLE job_marker(job_id TEXT PRIMARY KEY REFERENCES career_job(id),json TEXT NOT NULL);
        CREATE TABLE rank_cache(cache_key TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES career_job(id),score REAL NOT NULL,excluded INTEGER NOT NULL,confidence REAL NOT NULL,json TEXT NOT NULL);
        CREATE INDEX rank_cache_order ON rank_cache(score DESC,confidence DESC,job_id);
        CREATE TABLE job_search_metadata(job_id TEXT PRIMARY KEY REFERENCES career_job(id),company_id TEXT NOT NULL,role TEXT NOT NULL,season TEXT NOT NULL,level TEXT NOT NULL,location TEXT NOT NULL,mode TEXT NOT NULL,salary REAL,currency TEXT,posted INTEGER,grad_min INTEGER,grad_max INTEGER);
        CREATE INDEX job_filter ON job_search_metadata(role,level,mode,posted);
        INSERT INTO career_schema VALUES(4);`);
        for (const job of this.jobs()) this.indexMetadata(job);
      });
    if (version < 5)
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE source_origin_block(origin TEXT PRIMARY KEY,until_at INTEGER NOT NULL); INSERT INTO career_schema VALUES(5);',
        );
      });
    this.global = new DiscoveryStore(this.db);
    // An interrupted page keeps its cursor and completed rows; no disappearance
    // decision is made until a complete authoritative snapshot succeeds.
    for (const source of this.sources())
      if (source.state.status === 'POLLING')
        this.setState(source.config.id, { ...source.state, status: 'INTERRUPTED', nextPollAt: 0 });
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  profile(): CandidateProfile | null {
    const row = this.db
      .prepare('SELECT json FROM candidate_profile ORDER BY version DESC LIMIT 1')
      .get();
    return row ? CandidateProfileSchema.parse(JSON.parse(String(row.json))) : null;
  }
  // Return the latest live revision of each custom ranking alongside unchanged built-in presets.
  rankings(): RankingProfile[] {
    const custom = this.db
      .prepare(
        'SELECT p.json FROM ranking_profile p WHERE p.revision=(SELECT MAX(q.revision) FROM ranking_profile q WHERE q.id=p.id) AND NOT EXISTS(SELECT 1 FROM ranking_profile_deleted d WHERE d.id=p.id) ORDER BY p.id',
      )
      .all()
      .map((r) => RankingProfileSchema.parse(JSON.parse(String(r.json))));
    return [...BUILTIN_RANKINGS, ...custom];
  }
  cloneRanking(id: string, name: string): RankingProfile {
    const base = this.rankings().find((p) => p.id === id);
    if (!base) throw new Error('RANKING_NOT_FOUND');
    const clone = RankingProfileSchema.parse({ ...base, id: randomUUID(), name, revision: 1 });
    this.db
      .prepare('INSERT INTO ranking_profile VALUES(?,?,?)')
      .run(clone.id, clone.revision, JSON.stringify(clone));
    return clone;
  }
  saveRanking(input: unknown): void {
    const parsed = RankingProfileSchema.parse(input);
    if (parsed.id.startsWith('builtin:')) throw new Error('BUILTIN_IMMUTABLE');
    this.transaction(() => {
      const old = this.rankings().find((p) => p.id === parsed.id);
      if (!old || parsed.revision !== old.revision + 1)
        throw new Error('RANKING_REVISION_CONFLICT');
      this.db
        .prepare('INSERT INTO ranking_profile VALUES(?,?,?)')
        .run(parsed.id, parsed.revision, JSON.stringify(parsed));
    });
  }
  deleteRanking(id: string): void {
    if (id.startsWith('builtin:') || !this.rankings().some((p) => p.id === id))
      throw new Error('RANKING_NOT_FOUND');
    this.transaction(() => {
      this.db.prepare('INSERT INTO ranking_profile_deleted VALUES(?)').run(id);
      if (this.defaultRanking() === id) this.setDefaultRanking('builtin:legacy-v1');
    });
  }
  defaultRanking(): string {
    return String(
      this.db.prepare("SELECT value FROM career_setting WHERE key='ranking-default'").get()
        ?.value ?? 'builtin:legacy-v1',
    );
  }
  setDefaultRanking(id: string): void {
    if (!this.rankings().some((p) => p.id === id)) throw new Error('RANKING_NOT_FOUND');
    this.db
      .prepare(
        "INSERT INTO career_setting VALUES('ranking-default',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(id);
  }
  importPreviews(): ImportPreview[] {
    return this.db
      .prepare('SELECT json FROM profile_import ORDER BY rowid DESC LIMIT 20')
      .all()
      .map((r) => ImportPreviewSchema.parse(JSON.parse(String(r.json))));
  }
  importPreview(id: string): ImportPreview {
    const row = this.db.prepare('SELECT json FROM profile_import WHERE id=?').get(id);
    if (!row) throw new Error('IMPORT_NOT_FOUND');
    return ImportPreviewSchema.parse(JSON.parse(String(row.json)));
  }
  saveImport(input: ImportPreview): void {
    const preview = ImportPreviewSchema.parse(input);
    this.db
      .prepare('INSERT INTO profile_import VALUES(?,?) ON CONFLICT DO NOTHING')
      .run(preview.id, JSON.stringify(preview));
  }
  rejectImport(id: string): void {
    const old = this.importPreview(id);
    if (old.status !== 'ready') throw new Error('IMPORT_ALREADY_REVIEWED');
    this.db
      .prepare('UPDATE profile_import SET json=? WHERE id=?')
      .run(JSON.stringify({ ...old, status: 'rejected' }), id);
  }
  commitImport(id: string, input: CandidateProfile): void {
    const profile = CandidateProfileSchema.parse(input);
    this.transaction(() => {
      const preview = this.importPreview(id);
      if (preview.status !== 'ready' || profile.version !== (this.profile()?.version ?? 0) + 1)
        throw new Error('IMPORT_VERSION_CONFLICT');
      this.db
        .prepare('INSERT INTO candidate_profile VALUES(?,?)')
        .run(profile.version, JSON.stringify(profile));
      this.db
        .prepare('UPDATE profile_import SET json=? WHERE id=?')
        .run(JSON.stringify({ ...preview, status: 'accepted' }), id);
    });
  }
  recordRanking(match: JobMatch): void {
    const data = JobMatchSchema.parse(match);
    if (!data.ranking) throw new Error('RANKING_METADATA_REQUIRED');
    const key = createHash('sha256')
      .update(
        JSON.stringify([data.job.id, data.job.contentSha256, data.profileVersion, data.ranking]),
      )
      .digest('hex');
    this.db
      .prepare('INSERT INTO ranking_snapshot VALUES(?,?,?) ON CONFLICT DO NOTHING')
      .run(key, data.job.id, JSON.stringify(data));
    if (data.ranking.method !== 'legacy-v1') {
      const requirements = extractRequirements(data.job.descriptionText, data.job.title);
      this.db
        .prepare('INSERT INTO job_requirements_v2 VALUES(?,?,?,?) ON CONFLICT DO NOTHING')
        .run(
          data.job.id,
          data.job.contentSha256,
          requirements.parserVersion,
          JSON.stringify(requirements),
        );
    }
  }
  saveProfile(input: unknown): void {
    const profile = CandidateProfileSchema.parse(input);
    this.transaction(() => {
      const previous = this.profile();
      if (profile.version !== (previous?.version ?? 0) + 1)
        throw new Error('PROFILE_VERSION_CONFLICT');
      this.db
        .prepare('INSERT INTO candidate_profile VALUES (?,?)')
        .run(profile.version, JSON.stringify(profile));
    });
  }
  proposeFacts(facts: ProfileFact[]): void {
    const previous = this.profile();
    if (!previous) throw new Error('PROFILE_REQUIRED');
    const known = new Set(previous.facts.map((f) => f.id));
    this.saveProfile({
      ...previous,
      version: previous.version + 1,
      facts: [
        ...previous.facts,
        ...facts.filter((f) => !known.has(f.id)).map((f) => ({ ...f, verified: false })),
      ],
    });
  }
  private sourceRemovalKey(config: Pick<SourceConfig, 'ats' | 'region' | 'tenant'>): string {
    return `source-removed:${config.ats}:${config.region}:${config.tenant}`;
  }
  deleteSource(id: string): void {
    const source = this.sources().find((s) => s.config.id === id);
    if (!source) throw new Error('SOURCE_NOT_FOUND');
    this.transaction(() => {
      this.setting(this.sourceRemovalKey(source.config), 'true');
      // Drop polling checkpoints, retaining jobs, saved opportunities and source evidence.
      this.db.prepare('DELETE FROM job_source_snapshot WHERE source_id=?').run(id);
      this.db.prepare('DELETE FROM job_source WHERE id=?').run(id);
    });
  }
  saveSource(input: unknown): void {
    const config = SourceConfigSchema.parse(input);
    const old = this.sources().find((s) => s.config.id === config.id);
    if (
      this.sources().some(
        (s) =>
          s.config.id !== config.id &&
          s.config.ats === config.ats &&
          s.config.tenant === config.tenant &&
          s.config.region === config.region,
      )
    )
      throw new Error('DUPLICATE_SOURCE');
    if (
      old &&
      ['ats', 'tenant', 'region', 'company'].some(
        (key) => old.config[key as keyof SourceConfig] !== config[key as keyof SourceConfig],
      )
    )
      throw new Error('SOURCE_IDENTITY_IMMUTABLE');
    const state = old?.state ?? initialState();
    if (!config.enabled) state.status = 'DISABLED';
    else if (state.status === 'DISABLED') {
      state.status = 'NEVER_POLLED';
      state.nextPollAt = 0;
    }
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO job_source VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,state=excluded.state',
        )
        .run(config.id, JSON.stringify(config), JSON.stringify(state));
      this.db.prepare('DELETE FROM career_setting WHERE key=?').run(this.sourceRemovalKey(config));
    });
  }
  sources(): SourceView[] {
    return this.db
      .prepare('SELECT config,state FROM job_source ORDER BY id')
      .all()
      .map((r) => ({
        config: SourceConfigSchema.parse(JSON.parse(String(r.config))),
        state: SourceStateSchema.parse(JSON.parse(String(r.state))),
      }));
  }
  setState(id: string, input: SourceState): void {
    const state = SourceStateSchema.parse(input);
    this.db.prepare('UPDATE job_source SET state=? WHERE id=?').run(JSON.stringify(state), id);
  }
  originReady(origin: string): number {
    return Number(
      this.db.prepare('SELECT next_at FROM source_origin_quota WHERE origin=?').get(origin)
        ?.next_at ?? 0,
    );
  }
  reserveOrigin(origin: string, now: number): number {
    return this.transaction(() => {
      const at = Math.max(now, this.originReady(origin));
      this.db
        .prepare(
          'INSERT INTO source_origin_quota VALUES(?,?) ON CONFLICT(origin) DO UPDATE SET next_at=excluded.next_at',
        )
        .run(origin, at + 1000);
      return at;
    });
  }
  originBlockedUntil(origin: string): number {
    return Number(
      this.db.prepare('SELECT until_at FROM source_origin_block WHERE origin=?').get(origin)
        ?.until_at ?? 0,
    );
  }
  deferOrigin(origin: string, until: number): void {
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO source_origin_quota VALUES(?,?) ON CONFLICT(origin) DO UPDATE SET next_at=MAX(next_at,excluded.next_at)',
        )
        .run(origin, until);
      this.db
        .prepare(
          'INSERT INTO source_origin_block VALUES(?,?) ON CONFLICT(origin) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)',
        )
        .run(origin, until);
    });
  }
  private writeJob(job: Job): void {
    JobSchema.parse(job);
    const previous = this.db.prepare('SELECT json FROM career_job WHERE id=?').get(job.id);
    this.db
      .prepare(
        'INSERT INTO career_job VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical=excluded.canonical,company=excluded.company,requisition=excluded.requisition,signature=excluded.signature,json=excluded.json',
      )
      .run(
        job.id,
        job.canonicalUrl,
        normalized(job.company),
        job.requisitionId,
        signature(job),
        JSON.stringify(job),
      );
    this.indexMetadata(job);
    if (previous) {
      const old = JobSchema.parse(JSON.parse(String(previous.json)));
      if (old.title === job.title && old.descriptionText === job.descriptionText) return;
    }
    const rowid = Number(
      this.db.prepare('SELECT rowid FROM career_job WHERE id=?').get(job.id)!.rowid,
    );
    this.db.prepare('DELETE FROM job_fts WHERE rowid=?').run(rowid);
    this.db
      .prepare('INSERT INTO job_fts(rowid,title,keywords,description) VALUES(?,?,?,?)')
      .run(
        rowid,
        job.title,
        job.descriptionText
          .match(/\b(?:TypeScript|JavaScript|Python|Rust|SQL|Java|React|Go|C\+\+)\b/gi)
          ?.join(' ') ?? '',
        job.descriptionText,
      );
  }
  batch(
    source: SourceConfig,
    jobs: Job[],
    state: SourceState,
    pollId: string,
    complete: boolean,
    now: number,
  ): void {
    this.transaction(() => {
      for (const raw of jobs) {
        const key = raw.id;
        const membership = this.db
          .prepare('SELECT job_id FROM job_source_snapshot WHERE source_id=? AND source_key=?')
          .get(source.id, key);
        const companyKey = this.companyIdentity(raw.company);
        const row = membership
          ? this.db.prepare('SELECT json FROM career_job WHERE id=?').get(String(membership.job_id))
          : this.db
              .prepare(
                'SELECT j.json FROM career_job j LEFT JOIN job_search_metadata m ON m.job_id=j.id WHERE j.canonical=? OR (m.company_id=? AND j.requisition IS NOT NULL AND j.requisition=?) LIMIT 1',
              )
              .get(raw.canonicalUrl, companyKey, raw.requisitionId);
        const old = row ? JobSchema.parse(JSON.parse(String(row.json))) : null;
        const provenance = { ...raw.provenance[0]!, collectedAt: now };
        let job: Job = {
          ...raw,
          firstSeenAt: old?.firstSeenAt ?? now,
          lastSeenAt: now,
          provenance: old
            ? [...old.provenance.filter((p) => p.sourceKey !== key), provenance].slice(-100)
            : [provenance],
          id: old?.id ?? raw.id,
        };
        if (old && this.companyIdentity(old.company) !== companyKey)
          job = { ...old, duplicateGroup: 'EMPLOYER_CONFLICT', provenance: job.provenance };
        else if (
          old &&
          old.source !== raw.source &&
          (old.discovery?.kind === 'employer' ||
            !old.discovery ||
            raw.discovery?.kind !== 'employer')
        )
          job = { ...old, lastSeenAt: now, provenance: job.provenance }; // Never overwrite first-party fields with a second source.
        if (old) state.duplicates++;
        else state.accepted++;
        this.writeJob(job);
        this.db
          .prepare(
            'INSERT INTO source_record VALUES(?,?,?,?) ON CONFLICT(source_id,source_key) DO UPDATE SET job_id=excluded.job_id,json=excluded.json',
          )
          .run(source.id, key, job.id, JSON.stringify(raw));
        this.db
          .prepare(
            'INSERT INTO job_source_snapshot VALUES(?,?,?,?,0,?) ON CONFLICT(source_id,source_key) DO UPDATE SET job_id=excluded.job_id,poll_id=excluded.poll_id,missing=0,raw_hash=excluded.raw_hash',
          )
          .run(source.id, key, job.id, pollId, raw.rawSha256);
        const possible = this.db
          .prepare('SELECT json FROM career_job WHERE signature=? AND id<>?')
          .all(signature(job), job.id);
        for (const r of possible) {
          const other = JobSchema.parse(JSON.parse(String(r.json)));
          this.writeJob({ ...other, duplicateGroup: signature(job) });
          job.duplicateGroup = signature(job);
        }
        if (possible.length) this.writeJob(job);
      }
      if (complete) {
        this.db
          .prepare(
            'UPDATE job_source_snapshot SET missing=missing+1 WHERE source_id=? AND poll_id<>?',
          )
          .run(source.id, pollId);
        const missing = this.db
          .prepare(
            'SELECT DISTINCT job_id FROM job_source_snapshot WHERE source_id=? AND missing>=?',
          )
          .all(source.id, source.missingGracePolls);
        for (const r of missing) {
          const active = this.db
            .prepare(
              'SELECT COUNT(*) AS n FROM job_source_snapshot ss JOIN job_source s ON ss.source_id=s.id WHERE ss.job_id=? AND ss.missing<?',
            )
            .get(String(r.job_id), source.missingGracePolls);
          if (Number(active!.n) === 0) {
            const job = this.job(String(r.job_id));
            this.writeJob({ ...job, activeStatus: 'unknown' });
          }
        }
      }
      this.setState(source.id, state);
    });
  }
  /** Virtual membership reuses ingestion/provenance without adding a saved employer or poll grant. */
  globalSource(key: string, name: string, url: string): SourceConfig {
    const tenant = ('discovery-' + key).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
    const existing = this.sources().find(
      (s) => s.config.collection === 'global' && s.config.tenant === tenant,
    );
    if (existing) return existing.config;
    const source: SourceConfig = {
      id: randomUUID(),
      ats: 'jsonld',
      tenant,
      company: name.slice(0, 200),
      enabled: false,
      collection: 'global',
      region: 'global',
      intervalMs: 86400000,
      termsReviewedAt: new Date().toISOString(),
      timezone: 'UTC',
      priority: 0,
      missingGracePolls: 3,
      pageUrl: url,
    };
    this.saveSource(source);
    return source;
  }
  ingestDiscovered(runId: string, source: SourceConfig, jobs: Job[]): void {
    const state = {
      ...initialState(),
      status: 'OK' as const,
      parsed: jobs.length,
      lastSuccessAt: Date.now(),
    };
    this.batch(source, jobs, state, runId, false, Date.now());
    for (const raw of jobs) {
      const row = this.db
        .prepare('SELECT job_id FROM job_source_snapshot WHERE source_id=? AND source_key=?')
        .get(source.id, raw.id);
      if (row) this.global.link(runId, String(row.job_id), source.tenant);
    }
  }
  audit(sourceId: string, state: SourceState): void {
    this.db
      .prepare('INSERT INTO job_search_run VALUES(?,?,?)')
      .run(randomUUID(), sourceId, JSON.stringify(state));
    this.db.exec(
      'DELETE FROM job_search_run WHERE rowid NOT IN (SELECT rowid FROM job_search_run ORDER BY rowid DESC LIMIT 1000)',
    );
  }
  jobCount(): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM career_job').get()!.n);
  }
  jobs(): Job[] {
    return this.db
      .prepare('SELECT json FROM career_job ORDER BY id')
      .all()
      .map((r) => JobSchema.parse(JSON.parse(String(r.json))));
  }
  job(id: string): Job {
    const row = this.db.prepare('SELECT json FROM career_job WHERE id=?').get(id);
    if (!row) throw new Error('JOB_NOT_FOUND');
    return JobSchema.parse(JSON.parse(String(row.json)));
  }
  search(query: string): { job: Job; bm25Raw: number }[] {
    const words = query.match(/[\p{L}\p{N}_+#.-]+/gu)?.slice(0, 30) ?? [];
    const expression = words.map((w) => `"${w.replaceAll('"', '""')}"`).join(' OR ');
    if (!expression) return this.jobs().map((job) => ({ job, bm25Raw: 0 }));
    return this.db
      .prepare(
        'SELECT j.json,bm25(job_fts,4,2,1) AS rank FROM job_fts JOIN career_job j ON j.rowid=job_fts.rowid WHERE job_fts MATCH ? ORDER BY rank,j.id',
      )
      .all(expression)
      .map((r) => ({ job: JobSchema.parse(JSON.parse(String(r.json))), bm25Raw: Number(r.rank) }));
  }
  saveMatches(matches: JobMatch[]): void {
    this.transaction(() => {
      for (const m of matches) {
        JobMatchSchema.parse(m);
        this.db
          .prepare(
            'INSERT INTO job_match VALUES(?,?,?,?) ON CONFLICT(job_id,profile_version,scorer_version) DO UPDATE SET json=excluded.json WHERE job_match.json<>excluded.json',
          )
          .run(m.job.id, m.profileVersion, m.scorerVersion, JSON.stringify(m));
      }
    });
  }
  saveJob(id: string, saved: boolean): void {
    this.job(id);
    if (saved)
      this.db
        .prepare('INSERT INTO saved_opportunity VALUES(?,?) ON CONFLICT DO NOTHING')
        .run(id, Date.now());
    else this.db.prepare('DELETE FROM saved_opportunity WHERE job_id=?').run(id);
  }
  savedIds(): string[] {
    return this.db
      .prepare('SELECT job_id FROM saved_opportunity ORDER BY job_id')
      .all()
      .map((r) => String(r.job_id));
  }
  review(key: string): AiReview | null {
    const r = this.db.prepare('SELECT json FROM job_ai_review WHERE cache_key=?').get(key);
    return r ? AiReviewSchema.parse(JSON.parse(String(r.json))) : null;
  }
  saveReview(key: string, review: AiReview): void {
    AiReviewSchema.parse(review);
    this.db
      .prepare(
        'INSERT INTO job_ai_review VALUES(?,?) ON CONFLICT(cache_key) DO UPDATE SET json=excluded.json',
      )
      .run(key, JSON.stringify(review));
  }
  reviews(): AiReview[] {
    return this.db
      .prepare('SELECT json FROM job_ai_review ORDER BY rowid DESC LIMIT 100')
      .all()
      .map((r) => AiReviewSchema.parse(JSON.parse(String(r.json))));
  }
  setting(key: string, value?: string): string | null {
    if (value !== undefined)
      this.db
        .prepare(
          'INSERT INTO career_setting VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        .run(key, value);
    return (
      (this.db.prepare('SELECT value FROM career_setting WHERE key=?').get(key)?.value as string) ??
      null
    );
  }
  seedDirectory(entries: readonly Employer[]): void {
    this.transaction(() => {
      let changed = false;
      for (const input of entries) {
        const entry = EmployerSchema.parse(input);
        if (
          this.db
            .prepare('INSERT INTO employer_directory VALUES(?,?) ON CONFLICT DO NOTHING')
            .run(entry.id, JSON.stringify(entry)).changes
        )
          changed = true;
        for (const alias of [entry.company, ...entry.aliases])
          this.db
            .prepare('INSERT INTO employer_alias VALUES(?,?) ON CONFLICT DO NOTHING')
            .run(normalized(alias), entry.id);
      }
      if (changed) for (const job of this.jobs()) this.indexMetadata(job);
    });
  }
  directory(): Employer[] {
    return this.db
      .prepare('SELECT json FROM employer_directory ORDER BY id')
      .all()
      .map((r) => EmployerSchema.parse(JSON.parse(String(r.json))));
  }
  reviewDirectory(input: Employer): void {
    const e = EmployerSchema.parse(input);
    this.seedDirectory([e]);
    this.db.prepare('UPDATE employer_directory SET json=? WHERE id=?').run(JSON.stringify(e), e.id);
  }
  companyIdentity(name: string): string {
    return String(
      this.db.prepare('SELECT company_id FROM employer_alias WHERE alias=?').get(normalized(name))
        ?.company_id ?? normalized(name),
    );
  }
  directoryAllowed(config: SourceConfig, now = Date.now()): boolean {
    if (!config.directoryId) return config.ats !== 'jsonld';
    const entry = this.directory().find((e) => e.id === config.directoryId);
    return (
      !!entry &&
      entry.policy === 'approved' &&
      Date.parse(entry.refreshAfter) > now &&
      entry.ats === config.ats &&
      entry.tenant === config.tenant &&
      entry.region === config.region &&
      this.companyIdentity(config.company) === this.companyIdentity(entry.company) &&
      entry.pageUrl === config.pageUrl
    );
  }
  enableDirectory(now = Date.now()): void {
    for (const entry of this.directory()) {
      if (
        this.setting(this.sourceRemovalKey(entry)) === 'true' ||
        entry.policy !== 'approved' ||
        Date.parse(entry.refreshAfter) <= now ||
        this.sources().some(
          (s) =>
            s.config.directoryId === entry.id ||
            (s.config.ats === entry.ats &&
              s.config.tenant === entry.tenant &&
              s.config.region === entry.region),
        )
      )
        continue;
      this.saveSource({
        id: randomUUID(),
        ats: entry.ats,
        tenant: entry.tenant,
        company: entry.company,
        enabled: true,
        region: entry.region,
        intervalMs: 86400000,
        termsReviewedAt: entry.verifiedAt,
        timezone: 'UTC',
        priority: 0,
        missingGracePolls: 3,
        directoryId: entry.id,
        companyId: entry.id,
        ...(entry.pageUrl ? { pageUrl: entry.pageUrl } : {}),
      });
    }
    this.setting('search-all', 'true');
  }
  quarantine(sourceId: string, records: { hash: string; code: string }[], now: number): void {
    for (const r of records)
      this.db
        .prepare(
          'INSERT INTO source_quarantine VALUES(?,?,?,?) ON CONFLICT(source_id,hash) DO UPDATE SET observed_at=excluded.observed_at',
        )
        .run(sourceId, r.hash, r.code, now);
  }
  sourceRecords(jobId: string): Job[] {
    return this.db
      .prepare('SELECT json FROM source_record WHERE job_id=? ORDER BY source_id,source_key')
      .all(jobId)
      .map((r) => JobSchema.parse(JSON.parse(String(r.json))));
  }
  private indexMetadata(job: Job): void {
    const requirements =
      job.details?.requirements ?? extractRequirements(job.descriptionText, job.title);
    const graduation = requirements.items.filter((r) => r.kind === 'graduation');
    this.db
      .prepare('INSERT OR REPLACE INTO job_search_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        job.id,
        this.companyIdentity(job.company),
        job.details?.roleFamily ?? roleOf(job.title).family,
        job.details?.season ?? 'unknown',
        job.level,
        job.location.toLowerCase(),
        job.workMode,
        job.salary && /year|annual/i.test(job.salary.interval)
          ? (job.salary.max ?? job.salary.min)
          : null,
        job.salary?.currency ?? null,
        job.postedAt ? Date.parse(job.postedAt) || null : null,
        graduation[0]?.graduationStart ?? null,
        graduation[0]?.graduationEnd ?? null,
      );
  }
  private filteredQuery(input: JobSearch) {
    const s = JobSearchSchema.parse(input);
    const params: (string | number)[] = [];
    const where: string[] = [];
    const add = (sql: string, value: string | number) => {
      where.push(sql);
      params.push(value);
    };
    const words = s.query.match(/[\p{L}\p{N}_+#.-]+/gu)?.slice(0, 30) ?? [];
    if (words.length)
      add('job_fts MATCH ?', words.map((w) => `"${w.replaceAll('"', '""')}"`).join(' OR '));
    if (s.company) add("instr(lower(json_extract(j.json,'$.company')),lower(?))>0", s.company);
    if (s.scope === 'saved-companies')
      where.push(
        "EXISTS(SELECT 1 FROM job_source_snapshot ss JOIN job_source src ON src.id=ss.source_id WHERE ss.job_id=j.id AND COALESCE(json_extract(src.config,'$.collection'),'saved')<>'global')",
      );
    if (s.scope === 'company' && s.selectedSourceId)
      add(
        'EXISTS(SELECT 1 FROM job_source_snapshot ss WHERE ss.job_id=j.id AND ss.source_id=?)',
        s.selectedSourceId,
      );
    if (s.employmentType && s.employmentType !== 'all')
      add("json_extract(j.json,'$.details.employmentType')=?", s.employmentType);
    if (s.sourceId) {
      add(
        "(json_extract(j.json,'$.source')=? OR EXISTS(SELECT 1 FROM json_each(j.json,'$.provenance') p WHERE json_extract(p.value,'$.fields.registryId')=?))",
        s.sourceId,
      );
      params.push(s.sourceId);
    }
    if (s.availability && s.availability !== 'all')
      add(
        "COALESCE(json_extract(j.json,'$.discovery.availability'),CASE WHEN json_extract(j.json,'$.activeStatus')='open' THEN 'verified' ELSE 'unverified' END)=?",
        s.availability,
      );
    if (s.workMode !== 'all') add('m.mode=?', s.workMode);
    if (s.roleFamily && s.roleFamily !== 'all') add('m.role=?', s.roleFamily);
    if (s.season && s.season !== 'all') add('m.season=?', s.season);
    if (s.experienceLevel && s.experienceLevel !== 'all') add('m.level=?', s.experienceLevel);
    if (s.location) add('instr(m.location,lower(?))>0', s.location);
    if (s.minimumSalary !== undefined) {
      add('m.salary>=?', s.minimumSalary);
      add('m.currency=?', s.salaryCurrency ?? 'USD');
    }
    if (s.freshnessDays) add('m.posted>=?', Date.now() - s.freshnessDays * 86400000);
    if (s.graduationYear) {
      add('(m.grad_min IS NULL OR m.grad_min<=?)', s.graduationYear);
      add('(m.grad_max IS NULL OR m.grad_max>=?)', s.graduationYear);
    }
    if (s.savedOnly) where.push('EXISTS(SELECT 1 FROM saved_opportunity x WHERE x.job_id=j.id)');
    if (s.hideApplied) where.push("COALESCE(json_extract(t.json,'$.applied'),0)=0");
    if (s.feedback && s.feedback !== 'all') add("json_extract(t.json,'$.feedback')=?", s.feedback);
    if (s.newOnly)
      where.push(
        "COALESCE(json_extract(t.json,'$.seenAt'),0)<json_extract(j.json,'$.firstSeenAt')",
      );
    const from = `career_job j JOIN job_search_metadata m ON m.job_id=j.id LEFT JOIN job_marker t ON t.job_id=j.id ${words.length ? 'JOIN job_fts ON job_fts.rowid=j.rowid' : ''}`;
    return {
      sql: `SELECT j.json,${words.length ? 'bm25(job_fts,4,2,1)' : '0'} AS rank FROM ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${words.length ? 'rank,' : ''}j.id`,
      params,
    };
  }
  searchFiltered(input: JobSearch): { job: Job; bm25Raw: number }[] {
    return [...this.iterateFiltered(input)];
  }
  /** SQLite streams rows; neither retrieval nor cache preparation needs a whole-search job array. */
  *iterateFiltered(input: JobSearch): Generator<{ job: Job; bm25Raw: number }> {
    const q = this.filteredQuery(input);
    for (const row of this.db.prepare(q.sql).iterate(...q.params))
      yield { job: JobSchema.parse(JSON.parse(String(row.json))), bm25Raw: Number(row.rank) };
  }
  // Bind every scoring input and behavior-policy version so stale results cannot survive semantic changes.
  private cacheKey(
    row: { job: Job; bm25Raw: number },
    profile: CandidateProfile,
    config: RankingProfile,
    asOf: string,
  ): string {
    const intel = intelligenceOf(profile);
    const dynamic =
      intel.experience.some((w) => !w.end || w.end >= asOf) ||
      intel.education.some(
        (e) => e.graduation && e.graduation >= asOf.slice(0, e.graduation.length),
      ) ||
      intel.certifications.some((c) => c.expires);
    return createHash('sha256')
      .update(
        stable({
          job: [
            row.job.id,
            row.job.company,
            row.job.level,
            row.job.contentSha256,
            row.job.title,
            row.job.location,
            row.job.workMode,
            row.job.salary,
            row.job.activeStatus,
            row.job.duplicateGroup,
          ],
          evidence: intel,
          facts: profile.facts.filter((f) => !['name', 'email', 'phone', 'link'].includes(f.field)),
          preferences: profile.preferences,
          config,
          scorer: SCORING_POLICY_VERSION,
          candidatePolicy: CANDIDATE_POLICY_VERSION,
          taxonomy: TAXONOMY_VERSION,
          parser: REQUIREMENTS_PARSER_VERSION,
          date: dynamic ? asOf : 'static',
          lexical: config.method === 'legacy-v1' ? row.bm25Raw : 0,
        }),
      )
      .digest('hex');
  }
  cacheStats = { hits: 0, misses: 0 };
  cachedRanking(
    row: { job: Job; bm25Raw: number },
    profile: CandidateProfile,
    config: RankingProfile,
    asOf: string,
    ranker: typeof rankWithProfile = rankWithProfile,
  ): JobMatch {
    const key = this.cacheKey(row, profile, config, asOf);
    const cached = this.db.prepare('SELECT json FROM rank_cache WHERE cache_key=?').get(key);
    let match: JobMatch;
    if (cached) {
      this.cacheStats.hits++;
      match = JobMatchSchema.parse(JSON.parse(String(cached.json)));
    } else {
      this.cacheStats.misses++;
      match = ranker([row], profile, config, asOf)[0]!;
      this.db
        .prepare('INSERT INTO rank_cache VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
        .run(
          key,
          row.job.id,
          match.score,
          Number(match.excluded),
          match.confidence,
          JSON.stringify(match),
        );
      this.recordRanking(match);
    }
    return {
      ...match,
      job: row.job,
      profileVersion: profile.version,
      bm25Raw: row.bm25Raw,
      ...(match.ranking ? { ranking: { ...match.ranking, asOf } } : {}),
    };
  }
  rankedPage(
    rows: Iterable<{ job: Job; bm25Raw: number }>,
    profile: CandidateProfile,
    config: RankingProfile,
    asOf: string,
    search: JobSearch,
    budget = Number.POSITIVE_INFINITY,
  ): { matches: JobMatch[]; total: number; pending: number } {
    this.db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS current_search(job_id TEXT PRIMARY KEY,cache_key TEXT,bm25 REAL); DELETE FROM current_search;',
    );
    const insert = this.db.prepare('INSERT INTO current_search VALUES(?,?,?)');
    let scored = 0;
    this.transaction(() => {
      for (const row of rows) {
        const key = this.cacheKey(row, profile, config, asOf);
        if (
          !this.db.prepare('SELECT 1 FROM rank_cache WHERE cache_key=?').get(key) &&
          scored < budget
        ) {
          this.cachedRanking(row, profile, config, asOf);
          scored++;
        }
        insert.run(row.job.id, key, row.bm25Raw);
      }
    });
    const conditions = [search.includeExcluded ? '1' : 'r.excluded=0', 'r.score>=?'];
    const params: (string | number)[] = [search.minimumScore ?? 0];
    if (search.eligibility === 'pass')
      conditions.push(
        "r.excluded=0 AND NOT EXISTS(SELECT 1 FROM json_each(r.json,'$.checks') c WHERE json_extract(c.value,'$.result')='UNKNOWN')",
      );
    if (search.eligibility === 'review')
      conditions.push(
        "EXISTS(SELECT 1 FROM json_each(r.json,'$.checks') c WHERE json_extract(c.value,'$.result')='UNKNOWN')",
      );
    if (search.eligibility === 'fail') conditions.push('r.excluded=1');
    const base = `FROM rank_cache r JOIN current_search s ON s.cache_key=r.cache_key WHERE ${conditions.join(' AND ')}`;
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params)!.n);
    const page = this.db
      .prepare(
        `SELECT s.job_id,s.bm25 ${base} ORDER BY r.excluded,${search.sort === 'newest' ? "json_extract(r.json,'$.job.postedAt') DESC," : search.sort === 'salary' ? "COALESCE(json_extract(r.json,'$.job.salary.max'),json_extract(r.json,'$.job.salary.min')) DESC," : search.sort === 'company' ? "json_extract(r.json,'$.job.company')," : ''}r.score DESC,${config.method === 'legacy-v1' ? 's.bm25,' : 'r.confidence DESC,'}s.job_id LIMIT 50 OFFSET ?`,
      )
      .all(...params, search.offset ?? 0);

    return {
      total,
      pending: Number(
        this.db
          .prepare(
            'SELECT COUNT(*) n FROM current_search s LEFT JOIN rank_cache r ON r.cache_key=s.cache_key WHERE r.cache_key IS NULL',
          )
          .get()!.n,
      ),
      matches: page.map((r) =>
        this.cachedRanking(
          { job: this.job(String(r.job_id)), bm25Raw: Number(r.bm25) },
          profile,
          config,
          asOf,
        ),
      ),
    };
  }
  /** Count only definite exclusions; scores still being prepared are not filtered jobs. */
  discoveryFiltered(runId: string, search: JobSearch): number {
    const conditions = [search.includeExcluded ? '1' : 'r.excluded=0', 'r.score>=?'];
    if (search.eligibility === 'pass')
      conditions.push(
        "r.excluded=0 AND NOT EXISTS(SELECT 1 FROM json_each(r.json,'$.checks') c WHERE json_extract(c.value,'$.result')='UNKNOWN')",
      );
    if (search.eligibility === 'review')
      conditions.push(
        "EXISTS(SELECT 1 FROM json_each(r.json,'$.checks') c WHERE json_extract(c.value,'$.result')='UNKNOWN')",
      );
    if (search.eligibility === 'fail') conditions.push('r.excluded=1');
    return Number(
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT d.job_id) n FROM discovery_job d LEFT JOIN current_search s ON s.job_id=d.job_id LEFT JOIN rank_cache r ON r.cache_key=s.cache_key WHERE d.run_id=? AND (s.job_id IS NULL OR (r.cache_key IS NOT NULL AND NOT (${conditions.join(' AND ')})))`,
        )
        .get(runId, search.minimumScore ?? 0)!.n,
    );
  }
  markers(): JobMarker[] {
    return this.db
      .prepare('SELECT json FROM job_marker ORDER BY job_id')
      .all()
      .map((r) => JobMarkerSchema.parse(JSON.parse(String(r.json))));
  }
  markJob(jobId: string, change: Partial<Omit<JobMarker, 'jobId'>>): void {
    this.job(jobId);
    const old = this.markers().find((m) => m.jobId === jobId) ?? {
      jobId,
      feedback: 'none',
      applied: false,
      seenAt: 0,
    };
    const next = JobMarkerSchema.parse({ ...old, ...change });
    this.db
      .prepare(
        'INSERT INTO job_marker VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET json=excluded.json',
      )
      .run(jobId, JSON.stringify(next));
  }
  savedSearches(): SavedSearch[] {
    return this.db
      .prepare('SELECT json FROM saved_search ORDER BY id')
      .all()
      .map((r) =>
        SavedSearchSchema.parse(
          (() => {
            const raw = JSON.parse(String(r.json)) as SavedSearch;
            return {
              ...raw,
              search: { ...raw.search, scope: raw.search.scope ?? 'saved-companies' },
            };
          })(),
        ),
      );
  }
  saveSearch(name: string, search: JobSearch): SavedSearch {
    const saved = SavedSearchSchema.parse({
      id: randomUUID(),
      name,
      search: { ...search, offset: 0 },
    });
    this.db.prepare('INSERT INTO saved_search VALUES(?,?)').run(saved.id, JSON.stringify(saved));
    return saved;
  }
  deleteSearch(id: string): void {
    this.db.prepare('DELETE FROM saved_search WHERE id=?').run(id);
  }
  importRanking(json: string): RankingProfile {
    if (json.length > 20000) throw new Error('CONFIG_LIMIT');
    const input = RankingProfileSchema.parse(JSON.parse(json));
    const clone = RankingProfileSchema.parse({ ...input, id: randomUUID(), revision: 1 });
    this.db
      .prepare('INSERT INTO ranking_profile VALUES(?,?,?)')
      .run(clone.id, clone.revision, JSON.stringify(clone));
    return clone;
  }
  resetRanking(id: string, presetId: string): void {
    const old = this.rankings().find((p) => p.id === id);
    const preset = BUILTIN_RANKINGS.find((p) => p.id === presetId);
    if (!old || id.startsWith('builtin:') || !preset) throw new Error('RESET_NOT_ALLOWED');
    this.saveRanking({ ...preset, id, name: old.name, revision: old.revision + 1 });
  }
  close(): void {
    this.db.close();
  }
}
