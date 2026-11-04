/** Additive SQLite queue/cache for incremental global discovery, independent of saved employer grants. */
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  DiscoveryRunSchema,
  DiscoveryTaskSchema,
  DiscoveryListingSchema,
  migrateDiscoveryOptions,
  CompanyBoardSchema,
} from '@rovdo/shared';
import type { CompanyBoard, DiscoveryRun, DiscoveryTask, DiscoveryListing } from '@rovdo/shared';
export class DiscoveryStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
 CREATE TABLE IF NOT EXISTS company_request_budget(day TEXT NOT NULL,source TEXT NOT NULL,requests INTEGER NOT NULL,PRIMARY KEY(day,source));
 CREATE TABLE IF NOT EXISTS legacy_archive_run(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_board_state(identity TEXT PRIMARY KEY,json TEXT NOT NULL,lease_owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS company_inventory(identity TEXT PRIMARY KEY,ats TEXT NOT NULL,tenant TEXT NOT NULL,region TEXT NOT NULL,company TEXT NOT NULL,page_url TEXT NOT NULL,discovered_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,validated_at INTEGER,UNIQUE(ats,tenant,region));
 CREATE INDEX IF NOT EXISTS inventory_validated ON company_inventory(validated_at,identity);
 CREATE TABLE IF NOT EXISTS discovery_run(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS discovery_task(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES discovery_run(id),status TEXT NOT NULL,next_at INTEGER NOT NULL,priority REAL NOT NULL,json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS discovery_ready ON discovery_task(run_id,status,next_at,priority);
 CREATE INDEX IF NOT EXISTS discovery_task_failure ON discovery_task(run_id,json_extract(json,'$.sourceId')) WHERE status='blocked';
 CREATE TABLE IF NOT EXISTS discovery_listing(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES discovery_run(id),url TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(run_id,url));
 CREATE TABLE IF NOT EXISTS discovery_job(run_id TEXT NOT NULL REFERENCES discovery_run(id),job_id TEXT NOT NULL REFERENCES career_job(id),source_id TEXT NOT NULL,PRIMARY KEY(run_id,job_id,source_id));
 CREATE TABLE IF NOT EXISTS discovery_coverage(run_id TEXT NOT NULL,source_id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(run_id,source_id));
 CREATE TABLE IF NOT EXISTS discovery_cursor(task_id TEXT NOT NULL REFERENCES discovery_task(id),hash TEXT NOT NULL,PRIMARY KEY(task_id,hash));
 CREATE TABLE IF NOT EXISTS discovery_failure(key TEXT PRIMARY KEY,code TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS discovery_response(url TEXT PRIMARY KEY,json TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS discovery_failure_expiry ON discovery_failure(expires);
 CREATE INDEX IF NOT EXISTS discovery_response_expiry ON discovery_response(expires);
 `);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_source'").get())
      db.exec(
        "CREATE INDEX IF NOT EXISTS global_source_tenant ON job_source(json_extract(config,'$.tenant')) WHERE json_extract(config,'$.collection')='global'",
      );
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='career_setting'")
        .get() &&
      db.prepare("SELECT value FROM career_setting WHERE key='discovery-source-version'").get()
        ?.value !== '2'
    ) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // Migrate disposable source configuration, retaining every run, task, job and user marker.
        for (const row of db.prepare('SELECT id,json FROM discovery_run').all()) {
          const raw = JSON.parse(String(row.json));
          raw.options = migrateDiscoveryOptions(raw.options, true);
          db.prepare('UPDATE discovery_run SET json=? WHERE id=?').run(
            JSON.stringify(raw),
            String(row.id),
          );
        }
        for (const row of db.prepare('SELECT id,json FROM saved_search').all()) {
          const raw = JSON.parse(String(row.json));
          if (raw.search?.discovery) {
            raw.search.discovery = migrateDiscoveryOptions(raw.search.discovery);
            db.prepare('UPDATE saved_search SET json=? WHERE id=?').run(
              JSON.stringify(raw),
              String(row.id),
            );
          }
        }
        db.prepare("DELETE FROM career_setting WHERE key='jobspy-settings'").run();
        const supported = new Set([
          'company-inventory',
          'greenhouse',
          'lever',
          'ashby',
          'smartrecruiters',
          'remotive',
          'himalayas',
          'we-work-remotely',
          'simplify-new-grad-positions',
          'simplify-pitt-csc-summer-2027-internships',
          'vansh-new-grad-2027',
          'vansh-summer-2027-internships',
          'wayback',
          'common-crawl',
        ]);
        for (const row of db
          .prepare("SELECT id,json FROM discovery_task WHERE status IN ('pending','running')")
          .all()) {
          const raw = JSON.parse(String(row.json));
          if (!supported.has(raw.sourceId)) {
            raw.status = 'blocked';
            raw.error = 'SOURCE_RETIRED';
            db.prepare("UPDATE discovery_task SET status='blocked',json=? WHERE id=?").run(
              JSON.stringify(raw),
              String(row.id),
            );
          }
        }
        db.prepare(
          "INSERT OR REPLACE INTO career_setting(key,value) VALUES('discovery-source-version','2')",
        ).run();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    if (
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='career_setting'").get()
    )
      return;
    this.migrateJobSelections();
    if (
      this.db.prepare("SELECT value FROM career_setting WHERE key='board-directory-v1'").get()
        ?.value !== '1'
    ) {
      this.db.exec('SAVEPOINT board_projection_backfill');
      try {
        for (const row of this.db
          .prepare(
            'SELECT ats,tenant,region,validated_at FROM company_inventory WHERE validated_at IS NOT NULL',
          )
          .all())
          this.validateCompany(
            { ats: String(row.ats), tenant: String(row.tenant), region: String(row.region) },
            Number(row.validated_at),
          );
        this.db
          .prepare("INSERT OR REPLACE INTO career_setting VALUES('board-directory-v1','1')")
          .run();
        this.db.exec('RELEASE board_projection_backfill');
      } catch (error) {
        this.db.exec('ROLLBACK TO board_projection_backfill; RELEASE board_projection_backfill');
        throw error;
      }
    }
  }
  migrateJobSelections() {
    if (
      this.db.prepare("SELECT value FROM career_setting WHERE key='job-source-taxonomy'").get()
        ?.value === '3'
    )
      return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of this.db.prepare('SELECT id,json FROM saved_search').all()) {
        const raw = JSON.parse(String(row.json));
        if (raw.search?.discovery) {
          raw.search.discovery = migrateDiscoveryOptions(raw.search.discovery);
          this.db
            .prepare('UPDATE saved_search SET json=? WHERE id=?')
            .run(JSON.stringify(raw), String(row.id));
        }
      }
      this.db
        .prepare("INSERT OR REPLACE INTO career_setting VALUES('job-source-taxonomy','3')")
        .run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  reserveCompanyRequest(source: string, now: number) {
    const day = new Date(now).toISOString().slice(0, 10),
      limit = ['wayback', 'common-crawl'].includes(source) ? 24 : 128;
    const count = Number(
      this.db
        .prepare('SELECT requests FROM company_request_budget WHERE day=? AND source=?')
        .get(day, source)?.requests ?? 0,
    );
    if (count >= limit) return false;
    this.db
      .prepare(
        'INSERT INTO company_request_budget VALUES(?,?,1) ON CONFLICT(day,source) DO UPDATE SET requests=requests+1',
      )
      .run(day, source);
    return true;
  }
  migrateArchives() {
    if (this.db.prepare("SELECT value FROM career_setting WHERE key='archive-lanes-v1'").get())
      return;
    this.db.exec('SAVEPOINT archive_lanes');
    try {
      for (const row of this.db.prepare('SELECT json FROM discovery_run').all()) {
        const run = DiscoveryRunSchema.parse(JSON.parse(String(row.json)));
        if (
          run.lane === 'companies' ||
          !run.options.sourceIds.some((id) => ['wayback', 'common-crawl'].includes(id)) ||
          ['completed', 'canceled'].includes(run.status)
        )
          continue;
        this.db
          .prepare('INSERT OR IGNORE INTO legacy_archive_run VALUES(?,?)')
          .run(run.id, String(row.json));
        const companyRun = {
          ...run,
          id: randomUUID(),
          lane: 'companies' as const,
          options: {
            ...run.options,
            sourceIds: [
              ...new Set([
                'greenhouse',
                'lever',
                'ashby',
                'smartrecruiters',
                ...run.options.sourceIds.filter((id) => ['wayback', 'common-crawl'].includes(id)),
              ]),
            ],
          },
        };
        this.saveRun(companyRun);
        for (const taskRow of this.db
          .prepare(
            "SELECT json FROM discovery_task WHERE run_id=? AND json_extract(json,'$.sourceId') IN ('wayback','common-crawl')",
          )
          .all(run.id)) {
          const task = DiscoveryTaskSchema.parse(JSON.parse(String(taskRow.json)));
          this.db
            .prepare('UPDATE discovery_task SET run_id=?,json=? WHERE id=?')
            .run(companyRun.id, JSON.stringify({ ...task, runId: companyRun.id }), task.id);
        }
        for (const coverage of this.coverage(run.id).filter((c) =>
          ['wayback', 'common-crawl'].includes(c.sourceId),
        ))
          this.db
            .prepare('INSERT OR IGNORE INTO discovery_coverage VALUES(?,?,?)')
            .run(companyRun.id, coverage.sourceId, JSON.stringify(coverage));
        this.saveRun({ ...run, options: migrateDiscoveryOptions(run.options) });
      }
      this.db.prepare("INSERT INTO career_setting VALUES('archive-lanes-v1','1')").run();
      this.db.exec('RELEASE archive_lanes');
    } catch (error) {
      this.db.exec('ROLLBACK TO archive_lanes; RELEASE archive_lanes');
      throw error;
    }
  }
  private boardKey(feed: { ats: string; tenant: string; region: string }) {
    return [feed.ats, feed.tenant, feed.region].map((s) => s.toLowerCase()).join(':');
  }
  board(identity: string): CompanyBoard | null {
    const row = this.db
      .prepare(
        "SELECT * FROM company_inventory WHERE lower(ats)||':'||lower(tenant)||':'||lower(region)=? ORDER BY identity LIMIT 1",
      )
      .get(identity.toLowerCase());
    if (!row) return null;
    const state = this.db
      .prepare('SELECT json FROM company_board_state WHERE identity=?')
      .get(identity.toLowerCase());
    return CompanyBoardSchema.parse({
      identity: identity.toLowerCase(),
      ats: row.ats,
      tenant: row.tenant,
      region: row.region,
      company: row.company,
      pageUrl: row.page_url,
      nameStatus: row.company ? 'known' : 'pending',
      enabled: true,
      retiredAt: null,
      discoveredAt: row.discovered_at,
      lastAttempt: null,
      lastSuccess: null,
      nextRefresh: 0,
      retryAt: 0,
      failures: 0,
      health: 'pending',
      complete: false,
      contentHash: null,
      etag: null,
      lastModified: null,
      origin: 'discovery',
      ...(state ? JSON.parse(String(state.json)) : {}),
      observedAt: row.observed_at,
      validatedAt: row.validated_at,
    });
  }
  private saveBoard(board: CompanyBoard) {
    const parsed = CompanyBoardSchema.parse(board);
    this.db
      .prepare(
        'INSERT INTO company_board_state(identity,json) VALUES(?,?) ON CONFLICT(identity) DO UPDATE SET json=excluded.json',
      )
      .run(parsed.identity, JSON.stringify(parsed));
  }
  claimBoard(identity: string, owner: string, now: number) {
    const board = this.board(identity);
    if (!board) return false;
    this.saveBoard(board);
    return !!this.db
      .prepare(
        'UPDATE company_board_state SET lease_owner=?,lease_until=? WHERE identity=? AND (lease_owner IS NULL OR lease_owner=? OR lease_until<=?)',
      )
      .run(owner, now + 120000, identity, owner, now).changes;
  }
  releaseBoard(owner: string) {
    this.db
      .prepare('UPDATE company_board_state SET lease_owner=NULL,lease_until=0 WHERE lease_owner=?')
      .run(owner);
  }
  boardAttempt(identity: string, now: number) {
    const board = this.board(identity);
    if (board) this.saveBoard({ ...board, lastAttempt: now });
  }
  boardFailure(owner: string, reason: string, retryAt: number) {
    const row = this.db
      .prepare('SELECT identity FROM company_board_state WHERE lease_owner=?')
      .get(owner);
    if (row) {
      const board = this.board(String(row.identity));
      if (board)
        this.saveBoard({ ...board, health: reason, retryAt, failures: board.failures + 1 });
    }
    this.releaseBoard(owner);
  }
  setBoardEnabled(identity: string, enabled: boolean, retired = false) {
    const board = this.board(identity);
    if (!board) throw new Error('BOARD_NOT_FOUND');
    this.saveBoard({ ...board, enabled, retiredAt: retired ? Date.now() : null });
  }
  companyAllowed(feed: { ats: string; tenant: string; region: string }) {
    const key = this.boardKey(feed),
      board = this.board(key);
    if (board && (!board.enabled || board.retiredAt !== null)) return false;
    if (
      this.db
        .prepare("SELECT 1 FROM career_setting WHERE key=? COLLATE NOCASE AND value='true'")
        .get(`source-removed:${feed.ats}:${feed.region}:${feed.tenant}`)
    )
      return false;
    return !this.db
      .prepare(
        "SELECT 1 FROM job_source WHERE lower(json_extract(config,'$.ats'))=? AND lower(json_extract(config,'$.tenant'))=? AND json_extract(config,'$.region')=? AND json_extract(config,'$.enabled')=0 LIMIT 1",
      )
      .get(feed.ats.toLowerCase(), feed.tenant.toLowerCase(), feed.region);
  }
  rememberCompany(
    feed: { ats: string; tenant: string; region: string },
    company: string,
    pageUrl: string,
    at: number,
  ) {
    const key = this.boardKey(feed);
    const existing = this.board(key);
    this.db
      .prepare(
        `INSERT INTO company_inventory VALUES(?,?,?,?,?,?,?,?,NULL) ON CONFLICT(identity) DO UPDATE SET observed_at=MAX(observed_at,excluded.observed_at),company=CASE WHEN company_inventory.company='' THEN excluded.company ELSE company_inventory.company END`,
      )
      .run(
        key,
        feed.ats.toLowerCase(),
        feed.tenant.toLowerCase(),
        feed.region,
        company,
        pageUrl,
        at,
        at,
      );
    if (existing) {
      const conflict =
        !!company &&
        !!existing.company &&
        company.trim().toLowerCase() !== existing.company.trim().toLowerCase();
      this.saveBoard({
        ...existing,
        nameStatus:
          conflict || existing.nameStatus === 'conflict'
            ? 'conflict'
            : company
              ? 'known'
              : existing.nameStatus,
        company: existing.company || company,
        observedAt: at,
      });
    }
  }
  validateCompany(
    feed: { ats: string; tenant: string; region: string },
    at: number,
    details: {
      contentHash?: string;
      complete?: boolean;
      etag?: string;
      lastModified?: string;
      nextRefresh?: number;
    } = {},
  ) {
    const key = this.boardKey(feed),
      prior = this.board(key);
    if (!prior) throw new Error('BOARD_NOT_FOUND');
    this.db.exec('SAVEPOINT verified_board');
    try {
      this.db
        .prepare(
          "UPDATE company_inventory SET validated_at=? WHERE lower(ats)||':'||lower(tenant)||':'||lower(region)=?",
        )
        .run(at, key);
      const board: CompanyBoard = {
        ...prior,
        validatedAt: at,
        lastAttempt: at,
        lastSuccess: at,
        nextRefresh: details.nextRefresh ?? at + 3600000,
        retryAt: 0,
        failures: 0,
        health: 'healthy',
        complete: details.complete ?? false,
        contentHash: details.contentHash ?? prior.contentHash,
        etag: details.etag ?? prior.etag,
        lastModified: details.lastModified ?? prior.lastModified,
      };
      this.saveBoard(board);
      const existing = this.db
        .prepare(
          "SELECT id,json FROM employer_directory WHERE lower(json_extract(json,'$.ats'))=? AND lower(json_extract(json,'$.tenant'))=? AND json_extract(json,'$.region')=? ORDER BY id LIMIT 1",
        )
        .get(board.ats, board.tenant, board.region);
      const old = existing ? JSON.parse(String(existing.json)) : null;
      const entry = {
        id: old?.id ?? `board:${key}`,
        company: board.company,
        nameStatus: board.nameStatus,
        aliases: old?.aliases ?? [],
        ats: board.ats,
        tenant: board.tenant,
        region: board.region,
        reference: board.pageUrl,
        policyReference: old?.policyReference ?? board.pageUrl,
        policy: old?.policy ?? 'review',
        verifiedAt: new Date(at).toISOString(),
        refreshAfter: new Date(at + 7 * 86400000).toISOString(),
        responseHash: board.contentHash,
        pageUrl: old?.pageUrl ?? board.pageUrl,
      };
      this.db
        .prepare(
          'INSERT INTO employer_directory VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
        )
        .run(entry.id, JSON.stringify(entry));
      if (entry.company && entry.nameStatus === 'known')
        this.db.prepare('INSERT INTO employer_alias VALUES(?,?) ON CONFLICT DO NOTHING').run(
          entry.company
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim(),
          entry.id,
        );
      this.db.exec('RELEASE verified_board');
    } catch (error) {
      this.db.exec('ROLLBACK TO verified_board; RELEASE verified_board');
      throw error;
    }
  }
  companyBatch(after = '', limit = 50, validated = false, unvalidated = false) {
    return this.db
      .prepare(
        `SELECT identity,ats,tenant,region,company,page_url pageUrl,validated_at validatedAt FROM company_inventory WHERE identity>? ${validated ? 'AND validated_at IS NOT NULL' : unvalidated ? 'AND validated_at IS NULL' : ''} ORDER BY identity LIMIT ?`,
      )
      .all(after, Math.max(1, Math.min(100, limit)))
      .map((r) => ({
        identity: String(r.identity),
        ats: String(r.ats),
        tenant: String(r.tenant),
        region: String(r.region),
        company: String(r.company),
        pageUrl: String(r.pageUrl),
        validatedAt: r.validatedAt === null ? null : Number(r.validatedAt),
      }));
  }
  /** Disposable payloads only. Durable runs, jobs, memberships and user history are never pruned here. */
  cleanupExpired(now: number, limit = 100) {
    const count = Math.min(500, Math.max(1, Math.floor(limit)));
    const responses = Number(
      this.db
        .prepare(
          'DELETE FROM discovery_response WHERE url IN (SELECT url FROM discovery_response WHERE expires<=? ORDER BY expires,url LIMIT ?)',
        )
        .run(now, count).changes,
    );
    const failures = Number(
      this.db
        .prepare(
          'DELETE FROM discovery_failure WHERE key IN (SELECT key FROM discovery_failure WHERE expires<=? ORDER BY expires,key LIMIT ?)',
        )
        .run(now, count).changes,
    );
    return { responses, failures };
  }
  saveRun(input: DiscoveryRun) {
    const run = DiscoveryRunSchema.parse(input);
    this.db
      .prepare(
        'INSERT INTO discovery_run VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
      )
      .run(run.id, JSON.stringify(run));
  }
  run(id: string): DiscoveryRun {
    const r = this.db.prepare('SELECT json FROM discovery_run WHERE id=?').get(id);
    if (!r) throw new Error('RUN_NOT_FOUND');
    return DiscoveryRunSchema.parse(JSON.parse(String(r.json)));
  }
  runs(offset = 0): DiscoveryRun[] {
    return this.db
      .prepare('SELECT json FROM discovery_run ORDER BY rowid DESC LIMIT 20 OFFSET ?')
      .all(offset)
      .map((r) => DiscoveryRunSchema.parse(JSON.parse(String(r.json))));
  }
  enqueue(input: DiscoveryTask) {
    const t = DiscoveryTaskSchema.parse(input);
    this.db
      .prepare('INSERT INTO discovery_task VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
      .run(t.id, t.runId, t.status, t.nextAt, t.priority, JSON.stringify(t));
  }
  visitCursor(id: string, current: Record<string, unknown>, next: Record<string, unknown>) {
    const hash = (payload: Record<string, unknown>) =>
      createHash('sha256')
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(payload)
                .filter(([k]) => k !== 'lastPageHash')
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            ),
          ),
        )
        .digest('hex');
    const from = hash(current),
      to = hash(next);
    if (
      from === to ||
      this.db.prepare('SELECT 1 FROM discovery_cursor WHERE task_id=? AND hash=?').get(id, to)
    )
      throw new Error('NON_ADVANCING_PAGE');
    this.db.prepare('INSERT OR IGNORE INTO discovery_cursor VALUES(?,?)').run(id, from);
  }
  saveTask(input: DiscoveryTask) {
    const t = DiscoveryTaskSchema.parse(input);
    this.db
      .prepare(
        'UPDATE discovery_task SET status=?,next_at=?,priority=?,json=? WHERE id=? AND run_id=?',
      )
      .run(t.status, t.nextAt, t.priority, JSON.stringify(t), t.id, t.runId);
  }
  ready(id: string, now: number, limit = 3): DiscoveryTask[] {
    return this.db
      .prepare(
        "SELECT json FROM discovery_task WHERE run_id=? AND status='pending' AND next_at<=? ORDER BY priority DESC,rowid LIMIT ?",
      )
      .all(id, now, limit)
      .map((r) => DiscoveryTaskSchema.parse(JSON.parse(String(r.json))));
  }
  /** A missing worker or source policy failure applies to all queued queries for that source. */
  blockProviders(runId: string, sourceId: string, error: string) {
    this.db
      .prepare(
        "UPDATE discovery_task SET status='blocked',json=json_set(json,'$.status','blocked','$.error',?) WHERE run_id=? AND status='pending' AND json_extract(json,'$.sourceId')=? AND json_extract(json,'$.kind')='provider'",
      )
      .run(error, runId, sourceId);
  }
  runningRuns(): DiscoveryRun[] {
    return this.db
      .prepare(
        "SELECT json FROM discovery_run WHERE json_extract(json,'$.status')='running' ORDER BY rowid",
      )
      .all()
      .map((r) => DiscoveryRunSchema.parse(JSON.parse(String(r.json))));
  }
  recover(lane: 'jobs' | 'companies' = 'jobs') {
    for (const row of this.db
      .prepare("SELECT json FROM discovery_task WHERE status='running'")
      .all()) {
      const t = DiscoveryTaskSchema.parse(JSON.parse(String(row.json)));
      if ((this.run(t.runId).lane ?? 'jobs') !== lane) continue;
      this.saveTask({ ...t, status: 'pending' });
    }
    for (const row of this.db.prepare('SELECT json FROM discovery_run').all()) {
      const r = DiscoveryRunSchema.parse(JSON.parse(String(row.json)));
      if ((r.lane ?? 'jobs') !== lane) continue;
      if (r.status === 'running')
        this.saveRun({
          ...r,
          status: 'paused',
          reason: 'Restarted: resume this search to continue from saved checkpoints.',
        });
    }
  }
  saveListing(input: DiscoveryListing) {
    const l = DiscoveryListingSchema.parse(input);
    this.db
      .prepare('INSERT INTO discovery_listing VALUES(?,?,?,?,?) ON CONFLICT(run_id,url) DO NOTHING')
      .run(l.id, l.runId, l.url, l.status, JSON.stringify(l));
  }
  updateListing(
    runId: string,
    url: string,
    status: DiscoveryListing['status'],
    reason: string | null = null,
  ) {
    const row = this.db
      .prepare('SELECT json FROM discovery_listing WHERE run_id=? AND url=?')
      .get(runId, url);
    if (!row) return;
    const l = DiscoveryListingSchema.parse(JSON.parse(String(row.json)));
    this.db
      .prepare('UPDATE discovery_listing SET status=?,json=? WHERE run_id=? AND url=?')
      .run(status, JSON.stringify({ ...l, status, reason }), runId, url);
  }
  listings(runId: string, offset = 0): DiscoveryListing[] {
    return this.db
      .prepare(
        "SELECT json FROM discovery_listing WHERE run_id=? AND status<>'resolved' ORDER BY rowid DESC LIMIT 20 OFFSET ?",
      )
      .all(runId, offset)
      .map((r) => DiscoveryListingSchema.parse(JSON.parse(String(r.json))));
  }
  linkSnapshot(runId: string, sourceId: string, label: string) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO discovery_job SELECT ?,job_id,? FROM job_source_snapshot WHERE source_id=?',
      )
      .run(runId, label, sourceId);
  }
  link(runId: string, jobId: string, sourceId: string) {
    this.db
      .prepare('INSERT INTO discovery_job VALUES(?,?,?) ON CONFLICT DO NOTHING')
      .run(runId, jobId, sourceId);
  }
  stats(runId: string) {
    const n = (sql: string) => Number(this.db.prepare(sql).get(runId)!.n);
    return {
      jobs: n('SELECT COUNT(DISTINCT job_id) n FROM discovery_job WHERE run_id=?'),
      companies: n(
        "SELECT COUNT(DISTINCT lower(json_extract(j.json,'$.company'))) n FROM career_job j JOIN discovery_job d ON d.job_id=j.id WHERE d.run_id=?",
      ),
      listingCount: n(
        "SELECT COUNT(*) n FROM discovery_listing WHERE run_id=? AND status<>'resolved'",
      ),
      pending: n(
        "SELECT COUNT(*) n FROM discovery_task WHERE run_id=? AND status IN ('pending','running')",
      ),
      done: n("SELECT COUNT(*) n FROM discovery_task WHERE run_id=? AND status='done'"),
    };
  }
  coverage(runId: string) {
    return this.db
      .prepare('SELECT json FROM discovery_coverage WHERE run_id=? ORDER BY source_id')
      .all(runId)
      .map(
        (r) =>
          JSON.parse(String(r.json)) as {
            sourceId: string;
            status: string;
            requests: number;
            records: number;
            rejected: number;
            error: string | null;
            updatedAt: number;
          },
      );
  }
  note(
    runId: string,
    sourceId: string,
    status: string,
    records = 0,
    rejected = 0,
    error: string | null = null,
    requests = 0,
  ) {
    const old = this.coverage(runId).find((s) => s.sourceId === sourceId);
    const failed = this.db
      .prepare(
        "SELECT json_extract(json,'$.error') code FROM discovery_task WHERE run_id=? AND json_extract(json,'$.sourceId')=? AND (status='blocked' OR json_extract(json,'$.error') LIKE 'ARCHIVE_%') ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId, sourceId);
    if (failed && ['ready', 'collecting'].includes(status)) {
      status = 'partial';
      error = String(failed.code);
    }
    const next = {
      sourceId,
      status,
      requests: (old?.requests ?? 0) + requests,
      records: (old?.records ?? 0) + records,
      rejected: (old?.rejected ?? 0) + rejected,
      error,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO discovery_coverage VALUES(?,?,?) ON CONFLICT(run_id,source_id) DO UPDATE SET json=excluded.json',
      )
      .run(runId, sourceId, JSON.stringify(next));
  }
  failure(key: string, now: number): string | null {
    const row = this.db
      .prepare('SELECT code FROM discovery_failure WHERE key=? AND expires>?')
      .get(key, now);
    return row ? String(row.code) : null;
  }
  fail(key: string, code: string, expires: number) {
    this.db
      .prepare(
        'INSERT INTO discovery_failure VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET code=excluded.code,expires=excluded.expires',
      )
      .run(key, code, expires);
  }
  cache(url: string, now: number) {
    const row = this.db
      .prepare('SELECT json FROM discovery_response WHERE url=? AND expires>?')
      .get(url, now);
    return row
      ? (JSON.parse(String(row.json)) as {
          status: number;
          headers: Record<string, string>;
          body: string;
          capturedAt: number;
        })
      : null;
  }
  putCache(
    url: string,
    value: { status: number; headers: Record<string, string>; body: string; capturedAt: number },
    expires: number,
  ) {
    this.db
      .prepare(
        'INSERT INTO discovery_response VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET json=excluded.json,expires=excluded.expires',
      )
      .run(url, JSON.stringify(value), expires);
  }
}
