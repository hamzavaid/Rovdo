import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from './index';

const profile = { id: 'e7aca4d4-058c-49b9-8f41-ef362fe15d07', label: 'Fixture', kind: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: 'fixture', timeoutMs: 5000, maxOutputTokens: 512, includeUsage: true };
describe('SQLite settings and usage', () => {
  it('migrates idempotently with WAL and survives restart', () => {
    const folder = mkdtempSync(join(tmpdir(), 'rovdo-settings-'));
    const path = join(folder, 'settings.sqlite');
    try {
      const first = new SettingsStore(path);
      expect(first.journalMode()).toBe('wal');
      first.save(profile); first.close();
      const second = new SettingsStore(path);
      expect(second.list()).toEqual([profile]);
      second.remove(profile.id); expect(second.list()).toEqual([]); second.close();
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  it('rejects secrets and invalid writes without changing accepted settings', () => {
    const store = new SettingsStore(':memory:');
    try {
      store.save(profile);
      expect(() => store.save({ ...profile, apiKey: 'secret-canary' })).toThrow('VALIDATION_ERROR');
      expect(store.list()).toEqual([profile]);
    } finally { store.close(); }
  });
  it('persists only validated numeric telemetry, not chat or errors', () => {
    const folder = mkdtempSync(join(tmpdir(), 'rovdo-usage-'));
    const path = join(folder, 'settings.sqlite');
    try {
      const store = new SettingsStore(path); store.save(profile);
      store.recordUsage({ requestId: profile.id, profileId: profile.id, inputTokens: 12, outputTokens: 5, source: 'reported', estimatedUsd: 0.01, pricingVersion: 'fixture-v1', status: 'completed' });
      expect(store.usage().inputTokens).toBe(12);
      expect(() => store.recordUsage({ apiKey: 'secret-canary' })).toThrow('VALIDATION_ERROR');
      store.close();
      expect(readFileSync(path).toString()).not.toContain('secret-canary');
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
