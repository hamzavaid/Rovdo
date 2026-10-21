/**
 * Bounded public-feed polling with durable source checkpoints and per-origin quotas.
 * Failures stay source-local; disappearance decisions require a complete authoritative snapshot.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AtsAdapter, SourceError, sourceEndpoint } from '@rovdo/job-sources';
import type { JobSourceAdapter } from '@rovdo/job-sources';
import type { SourceConfig } from '@rovdo/shared';
import type { CareerStore } from '@rovdo/storage';
export { EMPLOYERS } from '@rovdo/job-sources';
export { discoverEmployers, refreshEmployers } from './employers';

export class DiscoveryEngine {
  private active = false;
  private stopping = false;
  private work: Promise<void> | null = null;
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly concurrency: number;
  constructor(
    private readonly store: CareerStore,
    private readonly adapter: (source: SourceConfig) => JobSourceAdapter = (source) =>
      new AtsAdapter(source),
    options: {
      now?: () => number;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
      random?: () => number;
      concurrency?: number;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      (async (ms, signal) => {
        await delay(ms, undefined, signal ? { signal } : {});
      });
    this.random = options.random ?? Math.random;
    this.concurrency = Math.max(1, Math.min(4, options.concurrency ?? 3));
  }
  get polling(): boolean {
    return this.active;
  }
  pollAll(): Promise<void> {
    if (this.active || this.stopping) return this.work ?? Promise.resolve();
    this.active = true;
    const work = (async () => {
      try {
        // Serialize each origin while polling a bounded number of independent origins concurrently.
        const groups = new Map<string, string[]>();
        for (const s of this.store
          .sources()
          .filter((s) => s.config.enabled)
          .sort(
            (a, b) =>
              b.config.priority - a.config.priority || a.config.id.localeCompare(b.config.id),
          )) {
          try {
            const origin = new URL(sourceEndpoint(s.config)).origin;
            const group = groups.get(origin) ?? [];
            group.push(s.config.id);
            groups.set(origin, group);
          } catch {
            this.store.setState(s.config.id, {
              ...s.state,
              status: 'FAILED_SOURCE',
              error: 'SOURCE_NOT_APPROVED',
              nextPollAt: this.now() + 86400000,
            });
          }
        }
        const queue = [...groups.values()];
        await Promise.all(
          Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
            while (queue.length && !this.stopping) {
              const group = queue.shift()!;
              for (const id of group) {
                if (this.stopping) break;
                await this.pollSource(id);
              }
            }
          }),
        );
      } finally {
        this.active = false;
      }
    })();
    this.work = work;
    return work;
  }
  poll(id: string): Promise<void> {
    if (this.active || this.stopping) return this.work ?? Promise.resolve();
    this.active = true;
    const work = this.pollSource(id).finally(() => {
      this.active = false;
    });
    this.work = work;
    return work;
  }
  private async pollSource(id: string): Promise<void> {
    const source = this.store.sources().find((s) => s.config.id === id);
    if (!source || !source.config.enabled || source.state.nextPollAt > this.now()) return;
    const config = source.config;
    if (!this.store.directoryAllowed(config, this.now())) {
      this.store.setState(id, {
        ...source.state,
        status: 'FAILED_SOURCE',
        error: 'POLICY_REVIEW_REQUIRED',
        nextPollAt: this.now() + 86400000,
      });
      return;
    }
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]);
    const origin = new URL(sourceEndpoint(config)).origin;
    const start = this.now();
    let state = { ...source.state };
    if (!state.cursor)
      state = {
        ...state,
        pollId: randomUUID(),
        returned: 0,
        parsed: 0,
        rejected: 0,
        duplicates: 0,
        accepted: 0,
        requests: 0,
      };
    state.status = 'POLLING';
    state.lastPollAt = start;
    state.error = null;
    this.store.setState(id, state);
    const adapter = this.adapter(config);
    // Recheck quota, policy and enablement at request time, not just when this poll was scheduled.
    const gate = async (url: string, signal: AbortSignal) => {
      if (new URL(url).origin !== origin) throw new Error('SOURCE_ORIGIN_BLOCKED');
      const at = this.store.reserveOrigin(origin, this.now());
      if (at - this.now() > 60000) {
        state.nextPollAt = at;
        throw new Error('ORIGIN_COOLDOWN');
      }
      if (at > this.now()) await this.sleep(at - this.now(), signal);
      const blocked = this.store.originBlockedUntil(origin);
      if (blocked > this.now()) {
        state.nextPollAt = Math.max(state.nextPollAt, blocked);
        throw new Error('ORIGIN_COOLDOWN');
      }
      if (
        signal.aborted ||
        !this.store.directoryAllowed(config, this.now()) ||
        !this.store.sources().find((s) => s.config.id === id)?.config.enabled
      )
        throw new Error('SOURCE_REVOKED');
      state.requests++;
    };
    adapter.setReadGate?.(gate);
    try {
      for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
        if (this.stopping) throw new Error('INTERRUPTED');
        if (!adapter.setReadGate) await gate(sourceEndpoint(config), signal);
        const page = await adapter.fetchPage(state, signal);
        state.responseStatus = page.status;
        if (page.status === 304 && state.lastSuccessAt === null)
          throw new SourceError(304, 0, 'CACHE_MISS');
        if (!this.store.sources().find((s) => s.config.id === id)?.config.enabled) return; // Revoked during fetch: no writes.
        this.store.quarantine(id, page.quarantine ?? [], this.now());
        state.returned += page.returned;
        state.rejected += page.quarantine?.length ?? 0;
        state.parsed += page.jobs.length;
        state.cursor = page.nextCursor;
        const complete = page.nextCursor === null;
        if (complete) {
          state.status = page.status === 304 || state.parsed > 0 ? 'OK' : 'EMPTY_SOURCE';
          state.lastSuccessAt = this.now();
          state.failures = 0;
          state.durationMs = this.now() - start;
          state.nextPollAt =
            this.now() +
            config.intervalMs +
            Math.floor(this.random() * Math.min(30000, config.intervalMs / 20));
          state.etag = ['lever', 'smartrecruiters', 'jsonld'].includes(config.ats)
            ? null
            : (page.headers.etag?.slice(0, 1000) ?? (page.status === 304 ? state.etag : null));
          state.lastModified = ['lever', 'smartrecruiters', 'jsonld'].includes(config.ats)
            ? null
            : (page.headers['last-modified']?.slice(0, 1000) ??
              (page.status === 304 ? state.lastModified : null));
        }
        // A partial/quarantined feed may add valid rows, but cannot declare unseen historical jobs missing.
        this.store.batch(
          config,
          page.jobs,
          state,
          state.pollId!,
          complete && page.status !== 304 && state.rejected === 0,
          this.now(),
        );
        if (complete) {
          this.store.audit(id, state);
          return;
        }
      }
      throw new Error('PAGE_BUDGET_EXCEEDED');
    } catch (error) {
      if (!this.store.sources().find((s) => s.config.id === id)?.config.enabled) return;
      state.status = this.stopping ? 'INTERRUPTED' : 'FAILED_SOURCE';
      state.failures++;
      if (error instanceof SourceError) {
        state.responseStatus = error.status;
        state.error = error.code;
        if (error.code === 'SCHEMA_DRIFT') state.rejected++;
      } else state.error = this.stopping ? 'INTERRUPTED' : 'NETWORK_OR_POLL_ERROR';
      const backoff =
        Math.min(3600000, 1000 * 2 ** Math.min(state.failures, 11)) +
        Math.floor(this.random() * 1000);
      const retry = error instanceof SourceError ? error.retryAfterMs : 0;
      state.nextPollAt = Math.max(state.nextPollAt, this.now() + Math.max(backoff, retry));
      state.durationMs = this.now() - start;
      if (error instanceof SourceError && error.status === 429)
        this.store.deferOrigin(origin, this.now() + Math.max(retry, backoff));
      this.store.setState(id, state);
      this.store.audit(id, state);
    }
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.controller.abort();
    await this.work;
  }
}

export * from './global-engine';
export * from './queries';
