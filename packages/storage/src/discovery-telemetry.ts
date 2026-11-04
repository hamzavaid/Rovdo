/** Bounded, durable operational metadata. Never stores response bodies or query strings. */
import type { DatabaseSync } from 'node:sqlite';
import { PipelineEventSchema, RequestRecordSchema } from '@rovdo/shared';
import type { PipelineEvent } from '@rovdo/shared';
import type { z } from 'zod';
export class DiscoveryTelemetry {
  constructor(private readonly telemetryDb: DatabaseSync) {}
  sourceSuccess(sourceId: string, observedAt: number, nextRefresh: number) {
    this.telemetryDb
      .prepare(
        'INSERT INTO discovery_source_health VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET observed_at=MAX(observed_at,excluded.observed_at),next_refresh=excluded.next_refresh',
      )
      .run(sourceId, observedAt, nextRefresh);
  }
  sourceTiming(sourceId: string) {
    const saved = this.telemetryDb
      .prepare('SELECT observed_at,next_refresh FROM discovery_source_health WHERE source_id=?')
      .get(sourceId);
    const board = this.telemetryDb
      .prepare(
        "SELECT MAX(json_extract(json,'$.lastSuccess')) observed_at,MIN(json_extract(json,'$.nextRefresh')) next_refresh FROM company_board_state WHERE json_extract(json,'$.ats')=? AND json_extract(json,'$.enabled')=1",
      )
      .get(sourceId);
    return {
      lastSuccessAt: saved
        ? Number(saved.observed_at)
        : board?.observed_at
          ? Number(board.observed_at)
          : null,
      nextRefreshAt: saved
        ? Number(saved.next_refresh)
        : board?.next_refresh
          ? Number(board.next_refresh)
          : null,
    };
  }
  count(runId: string, key: 'archiveRecords' | 'cacheHits', amount = 1) {
    this.telemetryDb
      .prepare(
        'INSERT INTO discovery_counter VALUES(?,?,?) ON CONFLICT(run_id,key) DO UPDATE SET value=value+excluded.value',
      )
      .run(runId, key, amount);
  }
  boardEvent(
    runId: string,
    identity: string,
    event: 'identified' | 'attempted' | 'verified' | 'failed' | 'checked',
  ) {
    this.telemetryDb
      .prepare('INSERT OR IGNORE INTO board_run_event VALUES(?,?,?)')
      .run(runId, identity, event);
  }
  metrics(runId: string) {
    const db = this.telemetryDb;
    const count = (sql: string, ...args: (string | number)[]) =>
      Number(db.prepare(sql).get(...args)!.n);
    const counters = Object.fromEntries(
      db
        .prepare('SELECT key,value FROM discovery_counter WHERE run_id=?')
        .all(runId)
        .map((r) => [String(r.key), Number(r.value)]),
    );
    const event = (type: string) =>
      count('SELECT COUNT(*) n FROM board_run_event WHERE run_id=? AND event=?', runId, type);
    const at = Number(
      JSON.parse(String(db.prepare('SELECT json FROM discovery_run WHERE id=?').get(runId)!.json))
        .createdAt,
    );
    const requests = count('SELECT COUNT(*) n FROM discovery_request WHERE run_id=?', runId);
    return {
      ...counters,
      requests,
      validationYield: requests ? event('verified') / requests : 0,
      archiveRecords: counters.archiveRecords ?? 0,
      cacheHits: counters.cacheHits ?? 0,
      candidateUrls: count('SELECT COUNT(*) n FROM discovery_listing WHERE run_id=?', runId),
      uniqueTenants: count(
        'SELECT COUNT(DISTINCT identity) n FROM board_run_event WHERE run_id=?',
        runId,
      ),
      validationAttempts: event('attempted'),
      validationsSucceeded: event('verified'),
      validationsFailed: event('failed'),
      boardsChecked: event('checked'),
      knownBoards: count('SELECT COUNT(*) n FROM company_inventory WHERE validated_at IS NOT NULL'),
      sourcePostings: count(
        "SELECT COALESCE(SUM(json_extract(json,'$.records')),0) n FROM discovery_coverage WHERE run_id=? AND source_id NOT IN ('wayback','common-crawl')",
        runId,
      ),
      newJobs: count(
        "SELECT COUNT(*) n FROM career_job j WHERE json_extract(j.json,'$.firstSeenAt')>=? AND EXISTS(SELECT 1 FROM discovery_job d WHERE d.job_id=j.id AND d.run_id=?)",
        at,
        runId,
      ),
      updatedJobs: count(
        "SELECT COUNT(*) n FROM career_job j WHERE json_extract(j.json,'$.firstSeenAt')<? AND json_extract(j.json,'$.contentChangedAt')>=? AND EXISTS(SELECT 1 FROM discovery_job d WHERE d.job_id=j.id AND d.run_id=?)",
        at,
        at,
        runId,
      ),
      unresolved: count(
        "SELECT COUNT(*) n FROM discovery_listing WHERE run_id=? AND status<>'resolved'",
        runId,
      ),
      errors: count(
        "SELECT COUNT(*) n FROM discovery_coverage WHERE run_id=? AND json_extract(json,'$.error') IS NOT NULL",
        runId,
      ),
    };
  }
  event(
    runId: string,
    stage: PipelineEvent['stage'],
    status: PipelineEvent['status'],
    count = 0,
    reason: string | null = null,
  ) {
    const db = this.telemetryDb;
    const last = db
      .prepare(
        "SELECT json FROM pipeline_event WHERE run_id=? AND json_extract(json,'$.stage')=? ORDER BY sequence DESC LIMIT 1",
      )
      .get(runId, stage);
    if (last) {
      const old = JSON.parse(String(last.json));
      if (old.status === status && old.count === count && old.reason === reason) return;
    }
    const event = PipelineEventSchema.parse({
      sequence: 0,
      runId,
      stage,
      status,
      count,
      reason,
      at: Date.now(),
    });
    const inserted = db
      .prepare('INSERT INTO pipeline_event(run_id,json) VALUES(?,?)')
      .run(runId, JSON.stringify(event));
    if (Number(inserted.lastInsertRowid) % 100 === 0)
      db.exec(
        'DELETE FROM pipeline_event WHERE sequence < (SELECT MAX(sequence)-5000 FROM pipeline_event)',
      );
  }
  events(runId: string) {
    return this.telemetryDb
      .prepare(
        'SELECT sequence,json FROM pipeline_event WHERE run_id=? ORDER BY sequence DESC LIMIT 40',
      )
      .all(runId)
      .reverse()
      .map((r) =>
        PipelineEventSchema.parse({ ...JSON.parse(String(r.json)), sequence: Number(r.sequence) }),
      );
  }
  request(record: Omit<z.infer<typeof RequestRecordSchema>, 'sequence'>) {
    const target = new URL(record.target);
    target.search = '';
    target.hash = '';
    const safe = RequestRecordSchema.parse({
      ...record,
      target: target.origin + target.pathname,
      sequence: 0,
    });
    const db = this.telemetryDb;
    const row = db
      .prepare('INSERT INTO discovery_request(run_id,source_id,json) VALUES(?,?,?)')
      .run(safe.runId, safe.sourceId, JSON.stringify(safe));
    if (Number(row.lastInsertRowid) % 100 === 0)
      db.exec(
        'DELETE FROM discovery_request WHERE sequence < (SELECT MAX(sequence)-5000 FROM discovery_request)',
      );
  }
  requests(lane: 'jobs' | 'companies', sourceId?: string, offset = 0) {
    const where =
      "FROM discovery_request q JOIN discovery_run r ON r.id=q.run_id WHERE COALESCE(json_extract(r.json,'$.lane'),'jobs')=?" +
      (sourceId ? ' AND q.source_id=?' : '');
    const params = sourceId ? [lane, sourceId] : [lane];
    const total = Number(this.telemetryDb.prepare(`SELECT COUNT(*) n ${where}`).get(...params)!.n);
    const rows = this.telemetryDb
      .prepare(`SELECT q.sequence,q.json ${where} ORDER BY q.sequence DESC LIMIT 25 OFFSET ?`)
      .all(...params, offset)
      .map((r) =>
        RequestRecordSchema.parse({ ...JSON.parse(String(r.json)), sequence: Number(r.sequence) }),
      );
    return { rows, total };
  }
}
