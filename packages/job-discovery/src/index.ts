import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AtsAdapter, SourceError, sourceEndpoint } from '@rovdo/job-sources';
import type { JobSourceAdapter } from '@rovdo/job-sources';
import type { SourceConfig } from '@rovdo/shared';
import type { CareerStore } from '@rovdo/storage';

export class DiscoveryEngine {
  private active = false; private stopping = false;
  private work: Promise<void> | null = null; private readonly controller = new AbortController();
  private readonly now: () => number; private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>; private readonly random: () => number;
  constructor(private readonly store: CareerStore, private readonly adapter: (source: SourceConfig) => JobSourceAdapter = (source) => new AtsAdapter(source), options: { now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number } = {}) {
    this.now = options.now ?? Date.now; this.sleep = options.sleep ?? (async (ms, signal) => { await delay(ms, undefined, signal ? { signal } : {}); }); this.random = options.random ?? Math.random;
  }
  get polling(): boolean { return this.active; }
  pollAll(): Promise<void> {
    if (this.active || this.stopping) return this.work ?? Promise.resolve();
    this.active = true;
    const work = (async () => {
      try { for (const source of this.store.sources().sort((a, b) => b.config.priority - a.config.priority || a.config.id.localeCompare(b.config.id))) { if (this.stopping) break; await this.pollSource(source.config.id); } }
      finally { this.active = false; }
    })(); this.work = work; return work;
  }
  poll(id: string): Promise<void> {
    if (this.active || this.stopping) return this.work ?? Promise.resolve(); this.active = true;
    const work = this.pollSource(id).finally(() => { this.active = false; }); this.work = work; return work;
  }
  private async pollSource(id: string): Promise<void> {
    const source = this.store.sources().find((s) => s.config.id === id); if (!source || !source.config.enabled || source.state.nextPollAt > this.now()) return;
    const config = source.config; const origin = new URL(sourceEndpoint(config)).origin; const start = this.now();
    let state = { ...source.state };
    if (!state.cursor) state = { ...state, pollId: randomUUID(), returned: 0, parsed: 0, rejected: 0, duplicates: 0, accepted: 0, requests: 0 };
    state.status = 'POLLING'; state.lastPollAt = start; state.error = null; this.store.setState(id, state);
    const adapter = this.adapter(config);
    try {
      for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
        if (this.stopping) throw new Error('INTERRUPTED');
        const at = this.store.reserveOrigin(origin, this.now());
        if (at - this.now() > 60000) { state.nextPollAt = at; throw new Error('ORIGIN_COOLDOWN'); }
        if (at > this.now()) await this.sleep(at - this.now(), this.controller.signal);
        const current = this.store.sources().find((s) => s.config.id === id); if (!current?.config.enabled) return;
        state.requests++;
        const page = await adapter.fetchPage(state, this.controller.signal); state.responseStatus = page.status;
        if (page.status === 304 && state.lastSuccessAt === null) throw new SourceError(304, 0, 'CACHE_MISS');
        if (!this.store.sources().find((s) => s.config.id === id)?.config.enabled) return; // Revoked during fetch: no writes.
        state.returned += page.returned; state.parsed += page.jobs.length; state.cursor = page.nextCursor;
        const complete = page.nextCursor === null;
        if (complete) {
          state.status = page.status === 304 || state.parsed > 0 ? 'OK' : 'EMPTY_SOURCE'; state.lastSuccessAt = this.now(); state.failures = 0; state.durationMs = this.now() - start;
          state.nextPollAt = this.now() + config.intervalMs + Math.floor(this.random() * Math.min(30000, config.intervalMs / 20));
          state.etag = config.ats === 'lever' ? null : page.headers.etag?.slice(0, 1000) ?? (page.status === 304 ? state.etag : null); state.lastModified = config.ats === 'lever' ? null : page.headers['last-modified']?.slice(0, 1000) ?? (page.status === 304 ? state.lastModified : null);
        }
        this.store.batch(config, page.jobs, state, state.pollId!, complete && page.status !== 304, this.now());
        if (complete) { this.store.audit(id, state); return; }
      }
      throw new Error('PAGE_BUDGET_EXCEEDED');
    } catch (error) {
      if (!this.store.sources().find((s) => s.config.id === id)?.config.enabled) return;
      state.status = this.stopping ? 'INTERRUPTED' : 'FAILED_SOURCE'; state.failures++;
      if (error instanceof SourceError) { state.responseStatus = error.status; state.error = error.code; if (error.code === 'SCHEMA_DRIFT') state.rejected++; }
      else state.error = this.stopping ? 'INTERRUPTED' : 'NETWORK_OR_POLL_ERROR';
      const backoff = Math.min(3600000, 1000 * 2 ** Math.min(state.failures, 11)) + Math.floor(this.random() * 1000);
      const retry = error instanceof SourceError ? error.retryAfterMs : 0;
      state.nextPollAt = Math.max(state.nextPollAt, this.now() + Math.max(backoff, retry)); state.durationMs = this.now() - start;
      if (error instanceof SourceError && error.status === 429) this.store.deferOrigin(origin, this.now() + Math.max(retry, backoff));
      this.store.setState(id, state); this.store.audit(id, state);
    }
  }
  async shutdown(): Promise<void> { this.stopping = true; this.controller.abort(); await this.work; }
}
