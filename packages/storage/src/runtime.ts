import { DatabaseSync } from 'node:sqlite';
import { BrowserRecordSchema, RunEventSchema } from '@rovdo/shared';
import type { BrowserRecord, RunEvent } from '@rovdo/shared';

export class RuntimeStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS browser_run (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS browser_event (run_id TEXT NOT NULL REFERENCES browser_run(id), seq INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(run_id,seq));`);
  }
  save(input: BrowserRecord, kind: RunEvent['kind'] = 'state', detail: string = input.state): void {
    const record = BrowserRecordSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO browser_run VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.id, JSON.stringify(record));
      const seq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM browser_event WHERE run_id=?').get(record.id)!.n);
      const event = RunEventSchema.parse({ seq, kind, at: Date.now(), detail });
      this.db.prepare('INSERT INTO browser_event VALUES (?,?,?)').run(record.id, seq, JSON.stringify(event)); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(): BrowserRecord[] { return this.db.prepare('SELECT record FROM browser_run ORDER BY rowid DESC LIMIT 100').all().map((r) => BrowserRecordSchema.parse(JSON.parse(String(r.record)))); }
  get(id: string): BrowserRecord { const r = this.db.prepare('SELECT record FROM browser_run WHERE id=?').get(id); if (!r) throw new Error('RUN_NOT_FOUND'); return BrowserRecordSchema.parse(JSON.parse(String(r.record))); }
  events(id: string): RunEvent[] { return this.db.prepare('SELECT event FROM browser_event WHERE run_id=? ORDER BY seq DESC LIMIT 500').all(id).map((r) => RunEventSchema.parse(JSON.parse(String(r.event)))).reverse(); }
  recover(): void { for (const r of this.list()) if (!['COMPLETED', 'FAILED', 'PARTIAL', 'CANCELED', 'PAUSED'].includes(r.state)) this.save({ ...r, state: 'PAUSED', approval: null, reason: 'RESTART_REQUIRES_RECONCILIATION' }, 'recovered'); }
  close(): void { this.db.close(); }
}
