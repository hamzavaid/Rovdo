/** Bounded, durable operational metadata. Never stores response bodies or query strings. */
import type { DatabaseSync } from 'node:sqlite';
import { PipelineEventSchema, RequestRecordSchema } from '@rovdo/shared';
import type { PipelineEvent } from '@rovdo/shared';
import type { z } from 'zod';
export class DiscoveryTelemetry {
  constructor(private readonly telemetryDb: DatabaseSync) {}
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
