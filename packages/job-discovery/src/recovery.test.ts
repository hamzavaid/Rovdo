import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter, canonicalUrl } from '@rovdo/job-sources';
import type { SourceConfig } from '@rovdo/shared';
import { DiscoveryEngine } from './index';

const config: SourceConfig = { id: '00000000-0000-4000-8000-000000000001', ats: 'lever', tenant: 'fixture', company: 'Fixture', enabled: true, region: 'global', intervalMs: 60000, termsReviewedAt: '2026-10-16T00:00:00.000Z', timezone: 'UTC', priority: 0, missingGracePolls: 2 };
const posting = (id: number) => ({ id: String(id), text: `Engineer ${id}`, hostedUrl: `https://jobs.lever.co/fixture/${id}`, descriptionPlain: 'TypeScript software engineer', categories: { location: 'Remote' } });
const response = (data: unknown, status = 200) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(data)) });
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) { const target = resolve(path); if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('rovdo-poll-')) throw new Error('Unsafe fixture cleanup path'); rmSync(target, { recursive: true, force: true }); } });
describe('durable source recovery and quotas', () => {
  it('resumes an interrupted paginated feed from its committed cursor after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rovdo-poll-')); directories.push(dir); const path = join(dir, 'state.sqlite');
    let time = 1000000000000; let store = new CareerStore(path); store.saveSource(config);
    const first = new DiscoveryEngine(store, (s) => new AtsAdapter(s, async (url) => new URL(url).searchParams.has('skip') ? response({}, 503) : response(Array.from({ length: 100 }, (_, i) => posting(i)))), { now: () => time, sleep: async (ms) => { time += ms; }, random: () => 0 });
    await first.poll(config.id); await first.shutdown(); expect(store.jobs()).toHaveLength(100); expect(store.sources()[0]!.state.cursor).toBe('100'); store.close();
    time += 60001; store = new CareerStore(path); const urls: string[] = [];
    const second = new DiscoveryEngine(store, (s) => new AtsAdapter(s, async (url) => { urls.push(url); return response([posting(100)]); }), { now: () => time, sleep: async (ms) => { time += ms; }, random: () => 0 });
    try { await second.poll(config.id); expect(urls).toHaveLength(1); expect(new URL(urls[0]!).searchParams.get('skip')).toBe('100'); expect(store.jobs()).toHaveLength(101); expect(store.sources()[0]!.state.cursor).toBeNull(); expect(store.sources()[0]!.state.status).toBe('OK'); }
    finally { await second.shutdown(); store.close(); }
  });
  it('enforces Retry-After across employers on the same origin and source opt-out during fetch', async () => {
    const store = new CareerStore(':memory:'); let time = 1000000000000; let calls = 0;
    const other = { ...config, id: '00000000-0000-4000-8000-000000000002', tenant: 'other' };
    store.saveSource(config); store.saveSource(other);
    const engine = new DiscoveryEngine(store, (s) => new AtsAdapter(s, async () => { calls++; return { ...response({}, 429), headers: { 'retry-after': '120' } }; }), { now: () => time, sleep: async (ms) => { time += ms; }, random: () => 0 });
    try { await engine.pollAll(); expect(calls).toBe(1); await engine.poll(config.id); expect(calls).toBe(1); }
    finally { await engine.shutdown(); store.close(); }
    const revoked = new CareerStore(':memory:'); revoked.saveSource(config);
    const worker = new DiscoveryEngine(revoked, (s) => new AtsAdapter(s, async () => { revoked.saveSource({ ...config, enabled: false }); return response([posting(1)]); }));
    try { await worker.poll(config.id); expect(revoked.jobs()).toHaveLength(0); expect(revoked.sources()[0]!.state.status).toBe('DISABLED'); }
    finally { await worker.shutdown(); revoked.close(); }
  });
  it('handles repeated snapshots without closing jobs after an outage and preserves positional query IDs', () => {
    expect(canonicalUrl('https://jobs.example.com/apply?jobId=42&utm_source=ad#apply')).toBe('https://jobs.example.com/apply?jobId=42');
    expect(() => canonicalUrl('javascript:alert(1)')).toThrow();
    const store = new CareerStore(':memory:'); store.saveSource(config); const state = store.sources()[0]!.state; const jobs = new AtsAdapter(config).normalize([posting(1)]);
    try { store.batch(config, jobs, state, 'one', true, 1); store.batch(config, [], state, 'two', true, 2); expect(store.jobs()[0]!.activeStatus).toBe('open'); store.batch(config, [], state, 'three', true, 3); expect(store.jobs()[0]!.activeStatus).toBe('unknown'); }
    finally { store.close(); }
  });
});
