/** Incremental global collection. Each tick processes bounded pages; durable tasks have no total results/employers cap. */
import { randomUUID } from 'node:crypto';
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
  fetchDiscoveryPage,
  feedFromUrl,
  inspectCareerPage,
  normalizeDiscoveryJob,
  permittedPage,
  robotsAllow,
  sha256,
  canonicalUrl,
  DiscoveryHttpError,
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
  private work: Promise<void> | null = null;
  private stopping = false;
  private controllers = new Map<string, AbortController>();
  private origins = new Map<string, Promise<unknown>>();
  private readonly transport: (url: string, options?: ReadOptions) => Promise<PublicResponse>;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  constructor(
    private readonly store: CareerStore,
    options: {
      transport?: (url: string, options?: ReadOptions) => Promise<PublicResponse>;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    } = {},
  ) {
    this.transport = options.transport ?? readPublic;
    this.sleep =
      options.sleep ??
      (async (ms, signal) => {
        await delay(ms, undefined, signal ? { signal } : {});
      });
    store.global.recover();
  }
  start(input: DiscoveryOptions): string {
    const options = DiscoveryOptionsSchema.parse(input);
    if (!options.sourceIds.length) throw new Error('SELECT_SOURCES');
    if (options.indexUrl) {
      const u = new URL(options.indexUrl);
      if (!permittedPage(u.href) || u.search || u.hash) throw new Error('INDEX_CONFIGURATION');
    }
    for (const id of options.sourceIds)
      if (!DISCOVERY_SOURCES.some((s) => s.id === id)) throw new Error('UNKNOWN_SOURCE');
    const profile = this.store.profile();
    const queries = discoveryQueries(
      profile,
      this.store.rankings().find((p) => p.id === this.store.defaultRanking())?.minimumEvidence ??
        0.5,
    );
    const duplicate = this.store.global
      .runningRuns()
      .find(
        (r) =>
          r.profileVersion === (profile?.version ?? null) &&
          stable(r.options) === stable(options) &&
          stable(r.queries) === stable(queries),
      );
    if (duplicate) return duplicate.id;
    const run: DiscoveryRun = {
      id: randomUUID(),
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profileVersion: profile?.version ?? null,
      queries,
      options,
      reason: null,
    };
    this.store.global.saveRun(run);
    for (const id of [...new Set(options.sourceIds)]) {
      const source = DISCOVERY_SOURCES.find((s) => s.id === id)!;
      if (['blocked', 'unsupported'].includes(source.status)) {
        this.store.global.note(run.id, id, source.status, 0, 0, source.limitation);
        continue;
      }
      if (source.adapter === 'ats') {
        this.store.global.note(run.id, id, 'waiting-for-discovered-employers');
        continue;
      }
      if (source.adapter === 'index' && !options.indexUrl) {
        this.store.global.note(
          run.id,
          id,
          'needs-configuration',
          0,
          0,
          'Configure a permitted SearXNG JSON endpoint.',
        );
        continue;
      }
      if (source.adapter === 'index')
        for (const query of queries)
          this.enqueue(run, id, 'provider', {
            query: [query, options.overrides[id]?.keywords, options.overrides[id]?.location]
              .filter(Boolean)
              .join(' ')
              .slice(0, 500),
            indexUrl: options.indexUrl,
            page: 1,
          });
      else {
        this.enqueue(run, id, 'provider', {});
        if (source.adapter === 'himalayas')
          for (const query of queries)
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
  private enqueue(
    run: DiscoveryRun,
    sourceId: string,
    kind: DiscoveryTask['kind'],
    payload: Record<string, unknown>,
    priority = 0,
  ) {
    const key =
      kind === 'resolve'
        ? String(payload.url)
        : kind === 'ats'
          ? JSON.stringify(payload.feed)
          : stable(payload);
    this.store.global.enqueue({
      id: sha256(run.id + sourceId + kind + key),
      runId: run.id,
      sourceId,
      kind,
      payload,
      status: 'pending',
      nextAt: 0,
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
    for (const run of this.store.global.runningRuns()) {
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
      const cached = this.store.global.cache(url, Date.now());
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
          const cachedAgain = this.store.global.cache(url, Date.now());
          if (cachedAgain)
            return {
              status: cachedAgain.status,
              headers: {
                ...cachedAgain.headers,
                'x-rovdo-observed-at': String(cachedAgain.capturedAt),
              },
              body: Buffer.from(cachedAgain.body, 'base64'),
            };
          const blocked = this.store.originBlockedUntil(origin);
          if (blocked > Date.now()) throw new DiscoveryHttpError(429, blocked - Date.now());
          const at = this.store.reserveOrigin(origin, Date.now());
          if (at > Date.now()) await this.sleep(at - Date.now(), signal);
          if (signal.aborted) throw new Error('CANCELED');
          const response = await this.transport(url, { signal, ...(headers ? { headers } : {}) });
          this.store.global.note(run.id, task.sourceId, 'collecting', 0, 0, null, 1);
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
          if (response.status >= 300 && response.status !== 404 && response.status !== 410)
            throw new DiscoveryHttpError(response.status);
          if (response.status === 200) {
            const ttl =
              origin === 'https://remotive.com'
                ? 21600000
                : origin === 'https://himalayas.app'
                  ? 86400000
                  : 3600000;
            this.store.global.putCache(
              url,
              { ...response, body: response.body.toString('base64'), capturedAt: Date.now() },
              Date.now() + ttl,
            );
          }
          return {
            ...response,
            headers: { ...response.headers, 'x-rovdo-observed-at': String(Date.now()) },
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
    const read = this.reader(run, task, signal);
    try {
      this.assertActive(run, signal);
      if (task.kind === 'provider') {
        const page = await fetchDiscoveryPage(task.sourceId, task.payload, read);
        this.assertActive(run, signal);
        const source = DISCOVERY_SOURCES.find((s) => s.id === task.sourceId)!;
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
            location: record.location,
            description: record.description,
            status: 'pending',
            reason: null,
          };
          this.store.global.saveListing(listing);
          const job = normalizeDiscoveryJob(record, config, run.id, Date.now());
          if (job) {
            jobs.push(job);
            this.store.global.updateListing(run.id, url, 'resolved');
          }
          if (source.adapter !== 'himalayas' && source.adapter !== 'remotive')
            this.enqueue(
              run,
              task.sourceId,
              'resolve',
              { url, company: record.company, title: record.title },
              this.priority(run, record),
            );
        }
        if (jobs.length) await this.store.ingestDiscoveredAsync(run.id, config, jobs, signal);
        this.store.global.note(run.id, source.id, 'ready', page.records.length, page.rejected);
        const hash = sha256(JSON.stringify(page.records.map((r) => r.url)));
        if (page.next && task.payload.lastPageHash === hash) throw new Error('NON_ADVANCING_PAGE');
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
      if (parent.aborted || this.stopping || this.store.global.run(run.id).status !== 'running') {
        this.store.global.saveTask({ ...task, status: 'pending' });
        return;
      }
      const status = error instanceof DiscoveryHttpError ? error.status : 0;
      const safe =
        error instanceof z.ZodError ||
        error instanceof SyntaxError ||
        (typeof error === 'object' && error && 'code' in error && error.code === 'SCHEMA_DRIFT')
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
            : status
              ? `HTTP_${status}`
              : 'SOURCE_RESPONSE_ERROR';
      const blocked =
        task.attempts >= 4 ||
        [400, 401, 403, 404, 410].includes(status) ||
        [
          'POLICY_BLOCKED',
          'ROBOTS_BLOCKED',
          'CHALLENGE_BLOCKED',
          'NON_ADVANCING_PAGE',
          'SCHEMA_DRIFT',
        ].includes(safe);
      const backoff = Math.max(
        error instanceof DiscoveryHttpError ? error.retryAfterMs : 0,
        Math.min(3600000, 1000 * 2 ** Math.min(task.attempts + 1, 11)),
      );
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
    const company = typeof task.payload.company === 'string' ? task.payload.company : '';
    if (direct && company) {
      this.enqueue(run, task.sourceId, 'ats', { feed: direct, company, pageUrl: url }, 2000);
      this.store.global.saveTask({ ...task, status: 'done' });
      return;
    }
    const robotsUrl = new URL('/robots.txt', url).href;
    const robots = await read(robotsUrl);
    if (
      robots.status !== 404 &&
      (robots.status !== 200 || !robotsAllow(robots.body.toString('utf8'), new URL(url).pathname))
    )
      throw new Error('ROBOTS_BLOCKED');
    const response = await read(url);
    if (response.status !== 200) throw new DiscoveryHttpError(response.status);
    const html = response.body.toString('utf8');
    if (/captcha|verify (?:you are|your identity)|access denied|cf-chl-/i.test(html))
      throw new Error('CHALLENGE_BLOCKED');
    const inspection = inspectCareerPage(html, url, company, true);
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
    const company = z.string().min(1).max(200).parse(task.payload.company);
    const virtual = this.store.globalSource(
      `${feed.ats}-${feed.tenant}`,
      company,
      String(task.payload.pageUrl),
    );
    let observedAt = Date.now();
    const adapter = new AtsAdapter({ ...virtual, ...feed, company }, async (url, options) => {
      const response = await read(url, options?.headers);
      observedAt = Number(response.headers['x-rovdo-observed-at']) || Date.now();
      return response;
    });
    const state = task.payload.state ? SourceStateSchema.parse(task.payload.state) : initialState();
    const page = await adapter.fetchPage(state, signal);
    this.assertActive(run, signal);
    const jobs = page.jobs.map((job) => ({
      ...job,
      discovery: {
        kind: 'employer' as const,
        availability: 'verified' as const,
        sourceName: company,
        sourceUrl: String(task.payload.pageUrl),
        attributionUrl: job.canonicalUrl,
        checkedAt: observedAt,
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
    this.store.global.updateListing(run.id, String(task.payload.pageUrl), 'resolved');
    if (page.nextCursor === state.cursor && page.nextCursor !== null)
      throw new Error('NON_ADVANCING_PAGE');
    this.store.global.saveTask({
      ...task,
      status: page.nextCursor ? 'pending' : 'done',
      payload: { ...task.payload, state: { ...state, cursor: page.nextCursor } },
      nextAt: Date.now(),
      attempts: 0,
      error: null,
    });
  }
  async control(id: string, action: 'pause' | 'resume' | 'cancel') {
    const run = this.store.global.run(id);
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
    const runs = this.store.global.runs();
    const run = this.store.global.runningRuns()[0] ?? runs[0] ?? null;
    return DiscoveryViewSchema.parse({
      run,
      runs,
      plan: discoveryQueries(
        this.store.profile(),
        this.store.rankings().find((p) => p.id === this.store.defaultRanking())?.minimumEvidence ??
          0.5,
      ),
      registry: DISCOVERY_SOURCES,
      coverage: run ? this.store.global.coverage(run.id) : [],
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
    for (const run of this.store.global.runningRuns())
      this.store.global.saveRun({
        ...run,
        status: 'paused',
        reason: 'Application closed; resume to continue.',
        updatedAt: Date.now(),
      });
  }
}
