/**
 * SQLite provider configuration and usage accounting, plus storage package exports.
 * Transactions migrate settings atomically; key values belong exclusively in the OS credential vault.
 */
import { DatabaseSync } from 'node:sqlite';
export { RuntimeStore } from './runtime';
export { CareerStore } from './career';
import { ProviderConfigSchema, UsageRecordSchema, UsageSummarySchema } from '@rovdo/shared';
import type { ProviderConfig } from '@rovdo/shared';

const migrations = [
  {
    version: 1,
    sql: `
  CREATE TABLE provider_config (id TEXT PRIMARY KEY, config_json TEXT NOT NULL);
  CREATE TABLE cost_usage (
    id INTEGER PRIMARY KEY, request_id TEXT NOT NULL, profile_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    usage_source TEXT NOT NULL, estimated_usd REAL, pricing_version TEXT,
    status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`,
  },
];

export class SettingsStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);');
    const latest = Number(
      this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_version').get()!
        .version,
    );
    if (latest > migrations.length) throw new Error('INTERNAL_ERROR');
    for (const migration of migrations.filter((item) => item.version > latest)) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_version VALUES (?)').run(migration.version);
        this.db.exec('COMMIT');
      } catch {
        this.db.exec('ROLLBACK');
        throw new Error('INTERNAL_ERROR');
      }
    }
  }
  journalMode(): string {
    return String(this.db.prepare('PRAGMA journal_mode').get()!.journal_mode);
  }
  list(): ProviderConfig[] {
    try {
      return this.db
        .prepare('SELECT config_json FROM provider_config ORDER BY rowid')
        .all()
        .map((row) => ProviderConfigSchema.parse(JSON.parse(String(row.config_json))));
    } catch {
      throw new Error('INTERNAL_ERROR');
    }
  }
  get(id: string): ProviderConfig {
    const profile = this.list().find((item) => item.id === id);
    if (!profile) throw new Error('PROFILE_NOT_FOUND');
    return profile;
  }
  save(input: unknown): void {
    const parsed = ProviderConfigSchema.safeParse(input);
    if (!parsed.success) throw new Error('VALIDATION_ERROR');
    this.db
      .prepare(
        'INSERT INTO provider_config VALUES (?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json',
      )
      .run(parsed.data.id, JSON.stringify(parsed.data));
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM provider_config WHERE id=?').run(id);
  }
  recordUsage(input: unknown): void {
    const parsed = UsageRecordSchema.safeParse(input);
    if (!parsed.success) throw new Error('VALIDATION_ERROR');
    const value = parsed.data;
    this.db
      .prepare(
        'INSERT INTO cost_usage (request_id,profile_id,input_tokens,output_tokens,usage_source,estimated_usd,pricing_version,status) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        value.requestId,
        value.profileId,
        value.inputTokens,
        value.outputTokens,
        value.source,
        value.estimatedUsd,
        value.pricingVersion,
        value.status,
      );
  }
  usage() {
    return UsageSummarySchema.parse(
      this.db
        .prepare(
          `SELECT COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(estimated_usd),0) AS estimatedUsd, COUNT(*) AS requests, COALESCE(SUM(CASE WHEN estimated_usd IS NULL THEN 1 ELSE 0 END),0) AS unpricedRequests FROM cost_usage`,
        )
        .get(),
    );
  }
  close(): void {
    this.db.close();
  }
}
