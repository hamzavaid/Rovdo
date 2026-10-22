/** Additive SQLite queue/cache for incremental global discovery, independent of saved employer grants. */
import type { DatabaseSync } from 'node:sqlite';
import { DiscoveryRunSchema, DiscoveryTaskSchema, DiscoveryListingSchema } from '@rovdo/shared';
import type { DiscoveryRun, DiscoveryTask, DiscoveryListing } from '@rovdo/shared';
export class DiscoveryStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
 CREATE TABLE IF NOT EXISTS discovery_run(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS discovery_task(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES discovery_run(id),status TEXT NOT NULL,next_at INTEGER NOT NULL,priority REAL NOT NULL,json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS discovery_ready ON discovery_task(run_id,status,next_at,priority);
 CREATE INDEX IF NOT EXISTS discovery_task_failure ON discovery_task(run_id,json_extract(json,'$.sourceId')) WHERE status='blocked';
 CREATE TABLE IF NOT EXISTS discovery_listing(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES discovery_run(id),url TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(run_id,url));
 CREATE TABLE IF NOT EXISTS discovery_job(run_id TEXT NOT NULL REFERENCES discovery_run(id),job_id TEXT NOT NULL REFERENCES career_job(id),source_id TEXT NOT NULL,PRIMARY KEY(run_id,job_id,source_id));
 CREATE TABLE IF NOT EXISTS discovery_coverage(run_id TEXT NOT NULL,source_id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(run_id,source_id));
 CREATE TABLE IF NOT EXISTS discovery_failure(key TEXT PRIMARY KEY,code TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS discovery_response(url TEXT PRIMARY KEY,json TEXT NOT NULL,expires INTEGER NOT NULL);
 `);
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
  recover() {
    for (const row of this.db
      .prepare("SELECT json FROM discovery_task WHERE status='running'")
      .all()) {
      const t = DiscoveryTaskSchema.parse(JSON.parse(String(row.json)));
      this.saveTask({ ...t, status: 'pending' });
    }
    for (const row of this.db.prepare('SELECT json FROM discovery_run').all()) {
      const r = DiscoveryRunSchema.parse(JSON.parse(String(row.json)));
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
        "SELECT json_extract(json,'$.error') code FROM discovery_task WHERE run_id=? AND json_extract(json,'$.sourceId')=? AND status='blocked' ORDER BY rowid DESC LIMIT 1",
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
