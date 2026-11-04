/** Incremental global collection. Each tick processes bounded pages; durable tasks have no total results/employers cap. */
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay, setImmediate as yieldTurn } from 'node:timers/promises';
import { z } from 'zod';
import { DiscoveryOptionsSchema, DiscoveryViewSchema, SourceStateSchema } from '@rovdo/shared';
import type {
  DiscoveryOptions,
  DiscoveryRun,
  DiscoveryTask,
  DiscoveryListing,
  Job,
} from '@rovdo/shared';
import type { CareerStore } from '@rovdo/storage';
import { readPublic } from '@rovdo/shared/network';
import type { PublicResponse, ReadOptions } from '@rovdo/shared/network';
import {
  AtsAdapter,
  BOARD_REGISTRY,
  DISCOVERY_SOURCES,
  BOARD_DISCOVERY_PROVIDERS,
  fetchDiscoveryPage,
  feedFromUrl,
  inspectCareerPage,
  publicBoardName,
  normalizeDiscoveryJob,
  permittedPage,
  robotsAllow,
  sha256,
  canonicalUrl,
  sourceEndpoint,
  DiscoveryHttpError,
  DiscoveryPolicyError,
} from '@rovdo/job-sources';
import type { DiscoveryRead, DiscoveryRecord } from '@rovdo/job-sources';
import { stable } from '@rovdo/career';
import { discoveryQueries } from './queries';
const initialState = () =>
  SourceStateSchema.parse({
    status: 'POLLING',
    cursor: null,
    pollId: null,
    etag: null,
    lastModified: null,
    lastPollAt: null,
    lastSuccessAt: null,
    nextPollAt: 0,
    failures: 0,
    responseStatus: null,
    returned: 0,
    parsed: 0,
    rejected: 0,
    duplicates: 0,
    accepted: 0,
    requests: 0,
    durationMs: 0,
    error: null,
    parserVersion: 'ats-v1',
  });
export class GlobalDiscoveryEngine {
  private readonly lane: 'jobs' | 'companies';
  private get providers() {
    return this.lane === 'companies'
      ? [...DISCOVERY_SOURCES, ...BOARD_DISCOVERY_PROVIDERS]
      : DISCOVERY_SOURCES;
  }
  private work: Promise<void> | null = null;
  private stopping = false;
  private controllers = new Map<string, AbortController>();
  private origins = new Map<string, Promise<unknown>>();
  private readonly transport: (url: string, options?: ReadOptions) => Promise<PublicResponse>;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  constructor(
    private readonly store: CareerStore,
    options: {
      lane?: 'jobs' | 'companies';
      transport?: (url: string, options?: ReadOptions) => Promise<PublicResponse>;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    } = {},
  ) {
    this.lane = options.lane ?? 'jobs';
    this.transport = options.transport ?? readPublic;
    this.sleep =
      options.sleep ??
      (async (ms, signal) => {
        await delay(ms, undefined, signal ? { signal } : {});
      });
    store.global.migrateArchives();
    store.global.recover(this.lane);
  }
  start(input: DiscoveryOptions): string {
    const options = DiscoveryOptionsSchema.parse(input);
    if (!options.sourceIds.length) throw new Error('SELECT_SOURCES');
    for (const id of options.sourceIds)
      if (!this.providers.some((s) => s.id === id)) throw new Error('UNKNOWN_SOURCE');
    const profile = this.store.profile();
    const qualificationQueries = discoveryQueries(
      profile,
      this.store.rankings().find((p) => p.id === this.store.defaultRanking())?.minimumEvidence ??
        0.5,
    );
    const keywords = options.filters?.keywords?.trim();
    const queries = keywords
      ? [
          ...new Set([
            keywords,
            ...qualificationQueries.map((q) => `${keywords} ${q}`.slice(0, 500)),
          ]),
        ]
      : qualificationQueries;
    const duplicate = this.store.global
      .runningRuns()
      .find(
        (r) =>
          (r.lane ?? 'jobs') === this.lane &&
          r.profileVersion === (profile?.version ?? null) &&
          stable(r.options) === stable(options) &&
          stable(r.queries) === stable(queries),
      );
    if (duplicate) return duplicate.id;
    const run: DiscoveryRun = {
      id: randomUUID(),
      lane: this.lane,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profileVersion: profile?.version ?? null,
      queries,
      options,
      reason: null,
    };
    this.store.global.saveRun(run);
    if (this.lane === 'companies')
      this.enqueue(run, 'company-inventory', 'provider', { after: '', candidates: true }, 100);

    if (
      this.lane === 'jobs' &&
      options.sourceIds.some((id) =>
        ['greenhouse', 'lever', 'ashby', 'smartrecruiters'].includes(id),
      )
    ) {
      const savedAfter = this.seedSavedCompanies(run, '');
      if (savedAfter) this.enqueue(run, 'company-inventory', 'provider', { savedAfter }, 10);
      // Prime the queue synchronously: cached employers must not wait behind slow archive reads.
      const known = this.store.global.companyBatch('', 50, true);
      for (const row of known) if (row.company) this.queueBoard(run, row);
      this.enqueue(
        run,
        'company-inventory',
        'provider',
        { after: known.at(-1)?.identity ?? '', validated: known.length > 0 },
        10,
      );
    }
    for (const id of [...new Set(options.sourceIds)]) {
      const source = this.providers.find((s) => s.id === id)!;
      if (['blocked', 'unsupported'].includes(source.status)) {
        this.store.global.note(run.id, id, source.status, 0, 0, source.limitation);
        continue;
      }
      if (source.adapter === 'ats') {
        if (!this.store.global.coverage(run.id).some((c) => c.sourceId === id))
          this.store.global.note(run.id, id, 'waiting-for-discovered-employers');
        continue;
      }
      {
        this.enqueue(run, id, 'provider', {});
        if (source.adapter === 'himalayas')
          for (const query of queries.slice(0, 3))
            this.enqueue(
              run,
              id,
              'provider',
              {
                query: [query, options.overrides[id]?.keywords, options.overrides[id]?.location]
                  .filter(Boolean)
                  .join(' ')
                  .slice(0, 500),
                page: 1,
              },
              -1,
            );
      }
    }
    return run.id;
  }
  private reuseBoard(
    run: DiscoveryRun,
    feed: { ats: string; tenant: string; region: string },
    company: string,
    pageUrl: string,
  ) {
    const key = [feed.ats, feed.tenant, feed.region].map((v) => v.toLowerCase()).join(':');
    const board = this.store.global.board(key);
    if (!this.store.global.companyAllowed(feed)) return true;
    if (
      board &&
      ((board.complete && board.nextRefresh > Date.now()) || board.retryAt > Date.now())
    ) {
      const source = this.store.globalSource(
        `${feed.ats}-${feed.tenant}-${feed.region}`,
        company,
        pageUrl,
      );
      this.store.global.linkSnapshot(run.id, source.id, source.tenant);
      this.store.global.note(
        run.id,
        feed.ats,
        board.retryAt > Date.now() ? 'retry-scheduled' : 'skipped-cached',
      );
      return true;
    }
    return false;
  }
  private queueBoard(
    run: DiscoveryRun,
    row: { ats: string; tenant: string; region: string; company: string; pageUrl: string },
  ) {
    if (
      !run.options.sourceIds.includes(row.ats) ||
      this.reuseBoard(run, row, row.company, row.pageUrl)
    )
      return;
    this.enqueue(
      run,
      'company-inventory',
      'ats',
      {
        feed: { ats: row.ats, tenant: row.tenant, region: row.region },
        company: row.company,
        pageUrl: row.pageUrl,
      },
      2000,
    );
  }
  /** Keyset batches avoid parsing the entire historical/global source registry at startup. */
  private seedSavedCompanies(run: DiscoveryRun, after: string): string | null {
    const rows = this.store.discoverySourceBatch(after);
    for (const { config, state } of rows) {
      if (
        config.ats === 'jsonld' ||
        !run.options.sourceIds.includes(config.ats) ||
        state.lastSuccessAt === null ||
        !this.store.directoryAllowed(config)
      )
        continue;
      const host =
        config.ats === 'lever'
          ? config.region === 'eu'
            ? 'jobs.eu.lever.co'
            : 'jobs.lever.co'
          : config.ats === 'greenhouse'
            ? 'job-boards.greenhouse.io'
            : config.ats === 'ashby'
              ? 'jobs.ashbyhq.com'
              : 'careers.smartrecruiters.com';
      const pageUrl = config.pageUrl ?? `https://${host}/${config.tenant}`;
      const feed = { ats: config.ats, tenant: config.tenant, region: config.region };
      this.store.global.rememberCompany(feed, config.company, pageUrl, state.lastSuccessAt);
      const known = this.store.global.board(
        [feed.ats, feed.tenant, feed.region].join(':').toLowerCase(),
      );
      if (!known?.validatedAt || known.validatedAt < state.lastSuccessAt)
        this.store.global.validateCompany(feed, state.lastSuccessAt, {
          complete: state.cursor === null,
          nextRefresh: state.nextPollAt,
        });
      if (state.nextPollAt > Date.now() && state.cursor === null) {
        this.store.global.linkSnapshot(run.id, config.id, config.tenant);
        continue;
      }
      this.enqueue(
        run,
        'company-inventory',
        'ats',
        { feed, company: config.company, pageUrl },
        2000,
      );
    }
    return rows.length === 50 ? rows.at(-1)!.config.id : null;
  }
  private enqueue(
    run: DiscoveryRun,
    sourceId: string,
    kind: DiscoveryTask['kind'],
    payload: Record<string, unknown>,
    priority = 0,
    nextAt = 0,
  ) {
    const key =
      kind === 'resolve'
        ? String(payload.url)
        : kind === 'ats'
          ? JSON.stringify(payload.feed)
          : stable(payload);
    this.store.global.enqueue({
      id: sha256(run.id + (kind === 'ats' ? '' : sourceId) + kind + key),
      runId: run.id,
      sourceId,
      kind,
      payload,
      status: 'pending',
      nextAt,
      attempts: 0,
      error: null,
      priority,
    });
  }
  async tick(): Promise<void> {
    if (this.work || this.stopping) return this.work ?? Promise.resolve();
    const pending = this.cycle();
    this.work = pending;
    try {
      await pending;
    } finally {
      this.work = null;
    }
  }
  private async cycle() {
    this.store.global.cleanupExpired(Date.now());
    for (const run of this.store.global
      .runningRuns()
      .filter((r) => (r.lane ?? 'jobs') === this.lane)) {
      if (this.stopping) break;
      const controller = this.controllers.get(run.id) ?? new AbortController();
      this.controllers.set(run.id, controller);
      await Promise.all(
        this.store.global
          .ready(run.id, Date.now(), 3)
          .map((t) => this.process(run, t, controller.signal)),
      );
      if (
        this.store.global.run(run.id).status === 'running' &&
        this.store.global.stats(run.id).pending === 0
      )
        this.store.global.saveRun({
          ...run,
          status: 'completed',
          updatedAt: Date.now(),
          reason:
            'Accessible selected sources completed; blocked, incomplete and unconfigured coverage is reported separately.',
        });
      if (this.store.global.run(run.id).status !== 'running') this.controllers.delete(run.id);
    }
  }
  private reader(run: DiscoveryRun, task: DiscoveryTask, signal: AbortSignal): DiscoveryRead {
    return async (url, headers) => {
      if (signal.aborted || this.stopping) throw new Error('CANCELED');
      if (!permittedPage(url)) throw new Error('POLICY_BLOCKED');
      // Immutable Common Crawl objects use multiple independent byte ranges.
      // URL-only cache keys would replay the first window for every later range.
      const cacheKey = headers?.range ? `${url}#rovdo-range=${headers.range}` : url;
      const cached = this.store.global.cache(cacheKey, Date.now());
      if (cached)
        return {
          status: cached.status,
          headers: { ...cached.headers, 'x-rovdo-observed-at': String(cached.capturedAt) },
          body: Buffer.from(cached.body, 'base64'),
        };
      const origin = new URL(url).origin;
      const previous = this.origins.get(origin) ?? Promise.resolve();
      const work = previous
        .catch(() => {})
        .then(async () => {
          const cachedAgain = this.store.global.cache(cacheKey, Date.now());
          if (cachedAgain)
            return {
              status: cachedAgain.status,
              headers: {
                ...cachedAgain.headers,
                'x-rovdo-observed-at': String(cachedAgain.capturedAt),
              },
              body: Buffer.from(cachedAgain.body, 'base64'),
            };
          const failure =
            this.store.global.failure('origin:' + origin, Date.now()) ??
            this.store.global.failure(url, Date.now());
          if (failure) throw new DiscoveryPolicyError(failure);
          const blocked = this.store.originBlockedUntil(origin);
          if (blocked > Date.now()) throw new DiscoveryHttpError(429, blocked - Date.now());
          if (
            this.lane === 'companies' &&
            this.store.global.runningRuns().some((r) => (r.lane ?? 'jobs') === 'jobs')
          )
            throw new Error('SEARCH_PRIORITY');
          const at = this.store.reserveOrigin(origin, Date.now());
          if (at > Date.now()) await this.sleep(at - Date.now(), signal);
          if (signal.aborted) throw new Error('CANCELED');
          const deferred = this.store.originBlockedUntil(origin);
          if (deferred > Date.now()) throw new DiscoveryHttpError(429, deferred - Date.now());
          const newlyFailed =
            this.store.global.failure('origin:' + origin, Date.now()) ??
            this.store.global.failure(url, Date.now());
          if (newlyFailed) throw new DiscoveryPolicyError(newlyFailed);
          if (this.lane === 'companies') {
            if (this.store.global.runningRuns().some((r) => (r.lane ?? 'jobs') === 'jobs'))
              throw new Error('SEARCH_PRIORITY');
            if (!this.store.global.reserveCompanyRequest(task.sourceId, Date.now()))
              throw new Error('DAILY_BUDGET');
          }
          this.store.global.note(run.id, task.sourceId, 'collecting', 0, 0, null, 1);
          let response: PublicResponse;
          try {
            response = await this.transport(url, {
              signal,
              ...(headers ? { headers } : {}),
              ...(task.sourceId === 'wayback' ? { timeoutMs: 30000 } : {}),
            });
          } catch (error) {
            const code =
              typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
            if (/CERT|TLS|SSL|EPROTO/.test(code)) {
              this.store.global.fail(
                'origin:' + origin,
                'TLS_CERTIFICATE_ERROR',
                Date.now() + 3600000,
              );
              throw new DiscoveryPolicyError('TLS_CERTIFICATE_ERROR');
            }
            throw error;
          }
          if (response.body.length > 8_000_000) throw new Error('RESPONSE_LIMIT');
          if (response.status === 429) {
            const retry = response.headers['retry-after'];
            const interval =
              retry && Number.isFinite(Number(retry))
                ? Number(retry) * 1000
                : retry
                  ? Date.parse(retry) - Date.now()
                  : 60000;
            const ms = Math.max(60000, Number.isFinite(interval) ? interval : 60000);
            this.store.deferOrigin(origin, Date.now() + ms);
            throw new DiscoveryHttpError(429, ms);
          }
          if (response.status >= 300 && response.status < 400 && response.status !== 304)
            this.store.global.fail(url, `HTTP_${response.status}`, Date.now() + 3600000);
          if (
            response.status >= 300 &&
            response.status !== 304 &&
            response.status !== 404 &&
            response.status !== 410
          ) {
            const retry = response.headers['retry-after'];
            const wait =
              retry && Number.isFinite(Number(retry))
                ? Number(retry) * 1000
                : retry
                  ? Date.parse(retry) - Date.now()
                  : 0;
            if (wait > 0) this.store.deferOrigin(origin, Date.now() + wait);
            throw new DiscoveryHttpError(
              response.status,
              Number.isFinite(wait) ? Math.max(0, wait) : 0,
            );
          }
          const capturedAt = Date.now();
          if (response.status === 200 || (response.status === 206 && headers?.range)) {
            const ttl =
              origin === 'https://remotive.com'
                ? 21600000
                : origin === 'https://himalayas.app'
                  ? 86400000
                  : 3600000;
            this.store.global.putCache(
              cacheKey,
              { ...response, body: response.body.toString('base64'), capturedAt },
              Date.now() + ttl,
            );
          }
          return {
            ...response,
            headers: { ...response.headers, 'x-rovdo-observed-at': String(capturedAt) },
          };
        });
      this.origins.set(origin, work);
      try {
        return await work;
      } finally {
        if (this.origins.get(origin) === work) this.origins.delete(origin);
      }
    };
  }
  private assertActive(run: DiscoveryRun, signal: AbortSignal) {
    if (signal.aborted || this.stopping || this.store.global.run(run.id).status !== 'running')
      throw new Error('CANCELED');
  }
  private async process(run: DiscoveryRun, task: DiscoveryTask, parent: AbortSignal) {
    this.store.global.saveTask({ ...task, status: 'running' });
    const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
    const baseRead = this.reader(run, task, signal);
    let observedAt = Date.now();
    const read: DiscoveryRead = async (url, headers) => {
      const response = await baseRead(url, headers);
      const observed = Number(response.headers['x-rovdo-observed-at']);
      if (Number.isFinite(observed) && observed >= 0) observedAt = Math.min(observedAt, observed);
      return response;
    };
    try {
      this.assertActive(run, signal);
      if (task.kind === 'provider' && task.sourceId === 'company-inventory') {
        if (typeof task.payload.savedAfter === 'string') {
          const after = this.seedSavedCompanies(run, task.payload.savedAfter);
          this.store.global.saveTask({
            ...task,
            status: after ? 'pending' : 'done',
            payload: { savedAfter: after ?? task.payload.savedAfter },
          });
          return;
        }
        const rows = this.store.global.companyBatch(
          String(task.payload.after ?? ''),
          50,
          task.payload.validated === true,
          task.payload.unvalidated === true,
        );
        for (const row of rows) {
          if (task.payload.candidates) {
            if ((row.validatedAt === null || !row.company) && this.store.global.companyAllowed(row))
              this.enqueue(
                run,
                'company-inventory',
                'resolve',
                { url: row.pageUrl, company: row.company, archive: true },
                100,
              );
          } else if (row.company) this.queueBoard(run, row);
        }
        const next = rows.length
          ? { ...task.payload, after: rows.at(-1)!.identity }
          : task.payload.validated
            ? { after: '', validated: false, unvalidated: true }
            : null;
        this.store.global.saveTask({
          ...task,
          payload: next ?? task.payload,
          status: next ? 'pending' : 'done',
        });
      } else if (task.kind === 'provider') {
        const page = await fetchDiscoveryPage(task.sourceId, task.payload, read);
        this.assertActive(run, signal);
        if (page.warning && page.next) {
          this.store.global.saveTask({
            ...task,
            status: task.attempts < 3 ? 'pending' : 'blocked',
            attempts: task.attempts + 1,
            nextAt: Date.now() + 3600000,
            error: page.warning,
          });
          this.enqueue(
            run,
            task.sourceId,
            'provider',
            page.next,
            task.priority - 0.001,
            Date.now() + (page.retryAfterMs ?? 60000),
          );
          this.store.global.note(run.id, task.sourceId, 'partial', 0, 0, page.warning);
          return;
        }
        const source = this.providers.find((s) => s.id === task.sourceId)!;
        const config = this.store.globalSource(source.id, source.name, source.url);
        const jobs: Job[] = [];
        let parsed = 0;
        for (const record of page.records) {
          if (parsed++ % 8 === 0) {
            await yieldTurn();
            this.assertActive(run, signal);
          }
          const url = canonicalUrl(record.url);
          const listing: DiscoveryListing = {
            id: sha256(run.id + url),
            runId: run.id,
            sourceId: task.sourceId,
            url,
            title: record.title,
            company: record.company,
            ...(record.companyEvidence ? { companyEvidence: record.companyEvidence } : {}),
            location: record.location,
            description: record.description,
            status: 'pending',
            reason: null,
          };
          this.store.global.saveListing(listing);
          const job = normalizeDiscoveryJob(record, config, run.id, observedAt);
          if (job) {
            jobs.push(job);
            this.store.global.updateListing(run.id, url, 'resolved');
          }
          if (source.adapter !== 'himalayas' && source.adapter !== 'remotive')
            this.enqueue(
              run,
              task.sourceId,
              'resolve',
              {
                url,
                company: record.company,
                title: record.title,
                archive: ['wayback', 'common-crawl'].includes(task.sourceId),
              },
              this.priority(run, record),
            );
        }
        if (jobs.length) await this.store.ingestDiscoveredAsync(run.id, config, jobs, signal);
        this.store.global.note(run.id, source.id, 'ready', page.records.length, page.rejected);
        const hash = page.rawPageHash ?? sha256(JSON.stringify(page.records.map((r) => r.url)));
        if (page.next) {
          this.store.global.visitCursor(task.id, task.payload, page.next);
          if (
            typeof page.next.page === 'number' &&
            !['wayback', 'common-crawl'].includes(task.sourceId) &&
            task.payload.lastPageHash === hash &&
            page.records.length
          )
            throw new Error('NON_ADVANCING_PAGE');
        }
        this.store.global.saveTask({
          ...task,
          payload: page.next ? { ...page.next, lastPageHash: hash } : task.payload,
          status: page.next ? 'pending' : 'done',
          nextAt: Date.now(),
          attempts: 0,
          error: null,
          priority: task.priority - 0.001,
        });
      } else if (task.kind === 'resolve') await this.resolve(run, task, read, signal);
      else await this.collectAts(run, task, read, signal);
    } catch (error) {
      if (error instanceof Error && ['SEARCH_PRIORITY', 'DAILY_BUDGET'].includes(error.message)) {
        this.store.global.releaseBoard(task.id);
        this.store.global.saveTask({
          ...task,
          status: 'pending',
          nextAt:
            error.message === 'DAILY_BUDGET'
              ? Date.parse(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
              : Date.now() + 2000,
          error: error.message,
        });
        return;
      }
      if (parent.aborted || this.stopping || this.store.global.run(run.id).status !== 'running') {
        this.store.global.releaseBoard(task.id);
        this.store.global.saveTask({ ...task, status: 'pending' });
        return;
      }
      const status = error instanceof DiscoveryHttpError ? error.status : 0;
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const networkError =
        signal.aborted ||
        (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) ||
        ['ABORT_ERR', 'ETIMEDOUT'].includes(code)
          ? 'REQUEST_TIMEOUT'
          : ['ENOTFOUND', 'EAI_AGAIN'].includes(code)
            ? 'DNS_LOOKUP_FAILED'
            : ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
              ? 'CONNECTION_FAILED'
              : null;
      const safe =
        error instanceof DiscoveryPolicyError
          ? error.code
          : error instanceof z.ZodError ||
              error instanceof SyntaxError ||
              (typeof error === 'object' &&
                error &&
                'code' in error &&
                error.code === 'SCHEMA_DRIFT')
            ? 'SCHEMA_DRIFT'
            : error instanceof Error &&
                [
                  'POLICY_BLOCKED',
                  'ROBOTS_BLOCKED',
                  'CHALLENGE_BLOCKED',
                  'NON_ADVANCING_PAGE',
                  'RESPONSE_LIMIT',
                  'SCHEMA_DRIFT',
                ].includes(error.message)
              ? error.message
              : (networkError ?? (status ? `HTTP_${status}` : 'SOURCE_RESPONSE_ERROR'));
      const archive =
        task.kind === 'provider' && ['wayback', 'common-crawl'].includes(task.sourceId);
      const blocked =
        error instanceof DiscoveryPolicyError ||
        (status >= 300 && status < 400) ||
        task.attempts >= (archive ? 1 : 4) ||
        [400, 401, 403, 404, 410].includes(status) ||
        [
          'POLICY_BLOCKED',
          'ROBOTS_BLOCKED',
          'CHALLENGE_BLOCKED',
          'NON_ADVANCING_PAGE',
          'SCHEMA_DRIFT',
        ].includes(safe);
      const backoff = Math.max(
        archive ? 60000 : 0,
        error instanceof DiscoveryHttpError ? error.retryAfterMs : 0,
        Math.min(3600000, 1000 * 2 ** Math.min(task.attempts + 1, 11)),
      );
      if (task.kind === 'ats') this.store.global.boardFailure(task.id, safe, Date.now() + backoff);
      this.store.global.saveTask({
        ...task,
        status: blocked ? 'blocked' : 'pending',
        attempts: task.attempts + 1,
        nextAt: Date.now() + backoff,
        error: safe,
      });
      this.store.global.note(run.id, task.sourceId, blocked ? 'blocked' : 'retrying', 0, 0, safe);
      if (task.kind === 'resolve')
        this.store.global.updateListing(
          run.id,
          String(task.payload.url),
          blocked ? 'blocked' : 'pending',
          safe,
        );
    }
  }
  private priority(run: DiscoveryRun, record: DiscoveryRecord) {
    const text = (record.title + ' ' + record.description + ' ' + record.location).toLowerCase();
    const override = run.options.overrides[record.sourceId];
    const priorities = [
      ...run.queries,
      ...[override?.keywords, override?.location].filter((v): v is string => !!v),
    ];
    return (
      (feedFromUrl(record.url) ? 1000 : 0) +
      priorities.reduce(
        (n, q) =>
          n + Number(q.split(' ').some((w) => w.length > 3 && text.includes(w.toLowerCase()))),
        0,
      )
    );
  }
  private async resolve(
    run: DiscoveryRun,
    task: DiscoveryTask,
    read: DiscoveryRead,
    signal: AbortSignal,
  ) {
    const url = canonicalUrl(String(task.payload.url));
    if (!permittedPage(url)) throw new Error('POLICY_BLOCKED');
    const direct = feedFromUrl(url);
    if (direct && !this.store.global.companyAllowed(direct)) {
      this.store.global.saveTask({ ...task, status: 'done', error: 'BOARD_OPTED_OUT' });
      return;
    }
    const pageUrl =
      direct && task.payload.archive === true ? `${new URL(url).origin}/${direct.tenant}` : url;
    let company = typeof task.payload.company === 'string' ? task.payload.company : '';
    if (direct && !company && task.payload.archive === true && direct.ats === 'greenhouse') {
      const response = await read(`https://boards-api.greenhouse.io/v1/boards/${direct.tenant}`);
      if (response.status !== 200) throw new DiscoveryHttpError(response.status);
      const metadata = z
        .object({ name: z.string().trim().min(1).max(200) })
        .parse(JSON.parse(response.body.toString('utf8')));
      company = metadata.name;
    }
    if (direct) this.store.global.rememberCompany(direct, company, pageUrl, Date.now());
    if (direct && company) {
      this.enqueue(
        run,
        task.sourceId,
        'ats',
        { feed: direct, company, pageUrl, listingUrl: url },
        2000,
      );
      this.store.global.saveTask({ ...task, status: 'done' });
      return;
    }
    const robotsUrl = new URL('/robots.txt', pageUrl).href;
    const robots = await read(robotsUrl);
    if (
      robots.status !== 404 &&
      (robots.status !== 200 ||
        !robotsAllow(
          robots.body.toString('utf8'),
          new URL(pageUrl).pathname + new URL(pageUrl).search,
        ))
    )
      throw new Error('ROBOTS_BLOCKED');
    const response = await read(pageUrl);
    if (response.status !== 200) throw new DiscoveryHttpError(response.status);
    const html = response.body.toString('utf8');
    if (/captcha|verify (?:you are|your identity)|access denied|cf-chl-/i.test(html))
      throw new Error('CHALLENGE_BLOCKED');
    if (direct && !company && task.payload.archive === true) {
      const name = publicBoardName(html, pageUrl);
      if (name) {
        this.enqueue(
          run,
          task.sourceId,
          'ats',
          { feed: direct, company: name, pageUrl, listingUrl: url },
          2000,
        );
        this.store.global.saveTask({ ...task, status: 'done' });
        return;
      }
    }
    const inspection = inspectCareerPage(html, pageUrl, company, true);
    this.assertActive(run, signal);
    let resolved = false;
    for (const raw of inspection.postings) {
      const p = z
        .looseObject({
          hiringOrganization: z.looseObject({
            name: z.string().min(1).max(200),
            url: z.string().optional(),
          }),
        })
        .safeParse(raw);
      if (!p.success) continue;
      const name = p.data.hiringOrganization.name;
      if (direct) this.store.global.rememberCompany(direct, name, pageUrl, Date.now());
      const virtual = this.store.globalSource(
        'page-' + sha256(new URL(url).origin).slice(0, 20),
        name,
        url,
      );
      const config = { ...virtual, company: name, pageUrl: url, directoryId: 'dynamic-page' };
      let normalized: Job[];
      try {
        normalized = new AtsAdapter(config).normalize({ jobs: [raw] });
      } catch {
        this.store.global.note(run.id, task.sourceId, 'partial', 0, 1, 'MALFORMED_POSTING');
        continue;
      }
      const board = BOARD_REGISTRY.some(
        (b) =>
          new URL(b.url).hostname.replace(/^www\./, '') ===
          new URL(url).hostname.replace(/^www\./, ''),
      );
      const orgUrl = p.data.hiringOrganization.url;
      let employer = false;
      try {
        employer = !board && !!orgUrl && new URL(orgUrl).origin === new URL(url).origin;
      } catch {
        /* Unknown identity remains unverified. */
      }
      const jobs = normalized.map((job) => ({
        ...job,
        activeStatus: employer ? job.activeStatus : ('unknown' as const),
        discovery: {
          kind: employer ? ('employer' as const) : ('aggregate' as const),
          availability: employer ? ('verified' as const) : ('unverified' as const),
          sourceName: name,
          sourceUrl: url,
          attributionUrl: url,
          checkedAt: Number(response.headers['x-rovdo-observed-at']) || Date.now(),
          runId: run.id,
          exportAllowed: true,
        },
      }));
      if (jobs.length) {
        await this.store.ingestDiscoveredAsync(run.id, virtual, jobs, signal);
        resolved = true;
      }
      for (const feed of inspection.feeds)
        this.enqueue(run, task.sourceId, 'ats', { feed, company: name, pageUrl: url }, 2000);
    }
    if (direct && !company && !resolved) {
      // Probe the provider contract without assigning a guessed employer name to any job.
      // The temporary config carries the tenant as an API routing identifier only; it is never stored.
      const endpoint = sourceEndpoint({
        id: randomUUID(),
        ...direct,
        company: direct.tenant,
        enabled: false,
        intervalMs: 86400000,
        termsReviewedAt: new Date().toISOString(),
        timezone: 'UTC',
        priority: 0,
        missingGracePolls: 3,
      });
      const probe = await read(endpoint);
      if (probe.status !== 200) throw new DiscoveryHttpError(probe.status);
      const raw: unknown = JSON.parse(probe.body.toString('utf8'));
      const data =
        direct.ats === 'lever'
          ? raw
          : raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)[
                direct.ats === 'smartrecruiters' ? 'content' : 'jobs'
              ]
            : undefined;
      z.array(z.record(z.string(), z.unknown())).parse(data);
      this.store.global.validateCompany(
        direct,
        Number(probe.headers['x-rovdo-observed-at']) || Date.now(),
        {
          contentHash: createHash('sha256').update(probe.body).digest('hex'),
          complete: true,
          nextRefresh: Date.now() + 86400000,
        },
      );
      this.store.global.updateListing(
        run.id,
        url,
        'incomplete',
        'Verified tenant; employer name awaits independent evidence.',
      );
      this.store.global.saveTask({ ...task, status: 'done' });
      return;
    }
    if (company)
      for (const feed of inspection.feeds)
        this.enqueue(run, task.sourceId, 'ats', { feed, company, pageUrl: url }, 2000);
    this.store.global.updateListing(
      run.id,
      url,
      resolved ? 'resolved' : 'incomplete',
      resolved ? null : 'No complete, supported public posting could be verified.',
    );
    this.store.global.saveTask({ ...task, status: 'done' });
  }
  private async collectAts(
    run: DiscoveryRun,
    task: DiscoveryTask,
    read: DiscoveryRead,
    signal: AbortSignal,
  ) {
    const feed = z
      .object({
        ats: z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters']),
        tenant: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
        region: z.enum(['global', 'eu']),
      })
      .parse(task.payload.feed);
    const registry = BOARD_REGISTRY.find((s) => s.name.toLowerCase() === feed.ats);
    if (registry && !run.options.sourceIds.includes(registry.id)) {
      this.store.global.note(run.id, registry.id, 'not-selected');
      this.store.global.saveTask({ ...task, status: 'done' });
      return;
    }
    if (!this.store.global.companyAllowed(feed)) {
      this.store.global.saveTask({ ...task, status: 'done', error: 'BOARD_OPTED_OUT' });
      return;
    }
    const company = z.string().min(1).max(200).parse(task.payload.company);
    this.store.global.rememberCompany(feed, company, String(task.payload.pageUrl), Date.now());
    if (this.reuseBoard(run, feed, company, String(task.payload.pageUrl))) {
      this.store.global.releaseBoard(task.id);
      this.store.global.saveTask({ ...task, status: 'done' });
      return;
    }
    const boardKey = [feed.ats, feed.tenant, feed.region].join(':').toLowerCase();
    if (!this.store.global.claimBoard(boardKey, task.id, Date.now())) {
      this.store.global.saveTask({ ...task, status: 'pending', nextAt: Date.now() + 1000 });
      return;
    }
    this.store.global.boardAttempt(boardKey, Date.now());
    const virtual = this.store.globalSource(
      `${feed.ats}-${feed.tenant}-${feed.region}`,
      company,
      String(task.payload.pageUrl),
    );
    let observedAt = Date.now();
    let contentHash: string | undefined;
    const adapter = new AtsAdapter(
      { ...virtual, ...feed, company },
      async (url, options) => {
        const response = await read(url, options?.headers);
        observedAt = Number(response.headers['x-rovdo-observed-at']) || Date.now();
        contentHash = createHash('sha256').update(response.body).digest('hex');
        return response;
      },
      { lightweight: true },
    );
    const priorBoard = this.store.global.board(boardKey);
    const state = task.payload.state
      ? SourceStateSchema.parse(task.payload.state)
      : {
          ...initialState(),
          etag: priorBoard?.etag ?? null,
          lastModified: priorBoard?.lastModified ?? null,
        };
    const page = await adapter.fetchPage(state, signal);
    if (page.status === 304) {
      if (!priorBoard?.complete) throw new Error('SCHEMA_DRIFT');
      this.store.global.validateCompany(feed, observedAt, { complete: true });
      this.store.global.linkSnapshot(run.id, virtual.id, virtual.tenant);
      this.store.global.note(run.id, feed.ats, 'checked-no-new-jobs');
      this.store.global.releaseBoard(task.id);
      this.store.global.saveTask({ ...task, status: 'done' });
      return;
    }

    this.store.global.validateCompany(feed, observedAt, {
      ...(contentHash ? { contentHash } : {}),
      complete: page.nextCursor === null && !page.quarantine?.length && !task.payload.partial,
      ...(page.headers.etag ? { etag: page.headers.etag } : {}),
      ...(page.headers['last-modified'] ? { lastModified: page.headers['last-modified'] } : {}),
    });
    this.assertActive(run, signal);
    const jobs = page.jobs.map((job) => ({
      ...job,
      discovery: {
        kind: 'employer' as const,
        availability:
          job.activeStatus === 'closed'
            ? ('closed' as const)
            : job.activeStatus === 'open'
              ? ('verified' as const)
              : ('unverified' as const),
        sourceName: company,
        sourceUrl: String(task.payload.pageUrl),
        attributionUrl: job.canonicalUrl,
        checkedAt: job.provenance[0]?.collectedAt ?? observedAt,
        runId: run.id,
        exportAllowed: true,
      },
    }));
    await this.store.ingestDiscoveredAsync(run.id, virtual, jobs, signal);
    this.store.global.note(
      run.id,
      registry?.id ?? task.sourceId,
      'ready',
      jobs.length,
      page.quarantine?.length ?? 0,
    );
    if (page.nextCursor === null) this.store.global.releaseBoard(task.id);
    this.store.global.updateListing(
      run.id,
      String(task.payload.listingUrl ?? task.payload.pageUrl),
      'resolved',
    );
    if (page.nextCursor === state.cursor && page.nextCursor !== null)
      throw new Error('NON_ADVANCING_PAGE');
    this.store.global.saveTask({
      ...task,
      status: page.nextCursor ? 'pending' : 'done',
      payload: {
        ...task.payload,
        partial: task.payload.partial === true || !!page.quarantine?.length,
        state: { ...state, cursor: page.nextCursor },
      },
      nextAt: Date.now(),
      attempts: 0,
      error: null,
    });
  }
  async control(id: string, action: 'pause' | 'resume' | 'cancel') {
    const run = this.store.global.run(id);
    if ((run.lane ?? 'jobs') !== this.lane) throw new Error('WRONG_DISCOVERY_LANE');
    if (action === 'resume') {
      if (run.status !== 'paused') throw new Error('RUN_NOT_PAUSED');
      await this.work;
      this.controllers.delete(id);
      this.store.global.saveRun({ ...run, status: 'running', updatedAt: Date.now(), reason: null });
      return;
    }
    this.store.global.saveRun({
      ...run,
      status: action === 'cancel' ? 'canceled' : 'paused',
      updatedAt: Date.now(),
      reason: action,
    });
    this.controllers.get(id)?.abort();
    await this.work;
    this.controllers.delete(id);
  }
  view() {
    const runs = this.store.global.runs().filter((r) => (r.lane ?? 'jobs') === this.lane);
    const run =
      this.store.global.runningRuns().find((r) => (r.lane ?? 'jobs') === this.lane) ??
      runs[0] ??
      null;
    return DiscoveryViewSchema.parse({
      run,
      runs,
      plan: discoveryQueries(
        this.store.profile(),
        this.store.rankings().find((p) => p.id === this.store.defaultRanking())?.minimumEvidence ??
          0.5,
      ),
      registry: this.lane === 'companies' ? BOARD_DISCOVERY_PROVIDERS : DISCOVERY_SOURCES,
      coverage: run
        ? this.store.global
            .coverage(run.id)
            .filter(
              (s) => this.lane === 'companies' || !['wayback', 'common-crawl'].includes(s.sourceId),
            )
            .map((s) =>
              run.status === 'completed' && s.status === 'waiting-for-discovered-employers'
                ? { ...s, status: 'no-employers-discovered', error: 'NO_EMPLOYERS_DISCOVERED' }
                : s,
            )
        : [],
      listings: run ? this.store.global.listings(run.id) : [],
      ...(run
        ? this.store.global.stats(run.id)
        : { jobs: 0, companies: 0, listingCount: 0, pending: 0, done: 0 }),
      filtered: 0,
    });
  }
  async shutdown() {
    this.stopping = true;
    for (const controller of this.controllers.values()) controller.abort();
    await this.work;
    for (const run of this.store.global
      .runningRuns()
      .filter((r) => (r.lane ?? 'jobs') === this.lane))
      this.store.global.saveRun({
        ...run,
        status: 'paused',
        reason: 'Application closed; resume to continue.',
        updatedAt: Date.now(),
      });
  }
}
