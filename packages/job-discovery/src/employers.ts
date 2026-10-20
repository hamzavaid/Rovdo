/**
 * Refreshes approved employer metadata and discovers feeds from explicitly permitted career pages.
 * Transport checks, robots rules and directory policy are enforced before a source becomes usable.
 */
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { CareerStore } from '@rovdo/storage';
import type { SourceConfig } from '@rovdo/shared';
import { readPublic } from '@rovdo/shared/network';
import type { PublicResponse, ReadOptions } from '@rovdo/shared/network';
import {
  AtsAdapter,
  feedFromUrl,
  inspectCareerPage,
  permittedPage,
  robotsAllow,
  sourceEndpoint,
} from '@rovdo/job-sources';
const hash = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
export async function refreshEmployers(
  store: CareerStore,
  signal: AbortSignal,
  transport: (url: string, options?: ReadOptions) => Promise<PublicResponse> = readPublic,
): Promise<void> {
  // Refresh verification freshness under an existing approved collection grant;
  // review/blocked policy states and persistent user opt-outs are never elevated.
  for (const entry of store
    .directory()
    .filter((e) => e.policy === 'approved' && Date.parse(e.refreshAfter) <= Date.now())
    .slice(0, 20)) {
    if (signal.aborted) break;
    const source = store.sources().find((s) => s.config.directoryId === entry.id);
    if (source && !source.config.enabled) continue;
    try {
      await discoverEmployers(
        store,
        {
          url: entry.reference,
          company: entry.company,
          policyUrl: entry.policyReference,
          permitted: true,
        },
        signal,
        transport,
      );
    } catch {
      /* Keep existing results and stale metadata; isolate this source. */
    }
  }
}
export async function discoverEmployers(
  store: CareerStore,
  request: { url: string; company: string; policyUrl: string; permitted: true },
  parent: AbortSignal,
  transport: (url: string, options?: ReadOptions) => Promise<PublicResponse> = readPublic,
): Promise<void> {
  if (!request.permitted || !permittedPage(request.url) || !permittedPage(request.policyUrl))
    throw new Error('SOURCE_BLOCKED');
  const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
  const get = async (url: string) => {
    const origin = new URL(url).origin;
    const now = Date.now();
    const at = store.reserveOrigin(origin, now);
    if (at - now > 30000) throw new Error('SOURCE_COOLDOWN');
    if (at > now) await delay(at - now, undefined, { signal });
    if (store.originBlockedUntil(origin) > Date.now()) throw new Error('SOURCE_COOLDOWN');
    const response = await transport(url, { signal });
    if (response.status === 429) {
      const retry = response.headers['retry-after'];
      const ms =
        retry && Number.isFinite(Number(retry))
          ? Number(retry) * 1000
          : retry
            ? Date.parse(retry) - Date.now()
            : 60000;
      store.deferOrigin(origin, Date.now() + Math.max(1000, Number.isFinite(ms) ? ms : 60000));
    }
    if (response.status >= 300 && response.status !== 404)
      throw new Error('SOURCE_UNAVAILABLE_OR_REDIRECT');
    return response;
  };
  let feeds = [];
  const direct = feedFromUrl(request.url);
  let postings: unknown[] = [];
  let pageBody: Buffer = Buffer.alloc(0);
  if (direct) feeds.push(direct);
  else {
    const url = new URL(request.url);
    const robots = await get(new URL('/robots.txt', url).href);
    if (
      robots.status !== 404 &&
      (robots.status !== 200 || !robotsAllow(robots.body.toString('utf8'), url.pathname))
    )
      throw new Error('ROBOTS_BLOCKED');
    const page = await get(url.href);
    if (page.status !== 200 || page.body.length > 2_000_000) throw new Error('PAGE_UNAVAILABLE');
    pageBody = page.body;
    const result = inspectCareerPage(pageBody.toString('utf8'), url.href, request.company);
    feeds = result.feeds.slice(0, 3);
    postings = result.postings;
  }
  if (!feeds.length && !postings.length) throw new Error('NO_SUPPORTED_PUBLIC_SOURCE');
  if (!feeds.length)
    feeds.push({ ats: 'jsonld', tenant: hash(request.url).slice(0, 24), region: 'global' });
  for (const feed of feeds) {
    const existing = store
      .directory()
      .find((e) => e.ats === feed.ats && e.tenant === feed.tenant && e.region === feed.region);
    if (
      existing &&
      store.companyIdentity(existing.company) !== store.companyIdentity(request.company)
    )
      throw new Error('EMPLOYER_IDENTITY_CONFLICT');
    const id =
      existing?.id ?? `reviewed:${hash(`${feed.ats}:${feed.tenant}:${request.url}`).slice(0, 24)}`;
    const at = new Date();
    const source: SourceConfig = {
      ...feed,
      id: randomUUID(),
      company: existing?.company ?? request.company,
      enabled: true,
      intervalMs: 86400000,
      termsReviewedAt: at.toISOString(),
      timezone: 'UTC',
      priority: 0,
      missingGracePolls: 3,
      directoryId: id,
      ...(feed.ats === 'jsonld' ? { pageUrl: request.url } : {}),
    };
    let body = pageBody;
    let payload: unknown = { jobs: postings };
    if (feed.ats !== 'jsonld') {
      const response = await get(sourceEndpoint(source));
      if (response.status !== 200) throw new Error('FEED_UNAVAILABLE');
      body = response.body;
      payload = JSON.parse(body.toString('utf8')) as unknown;
    }
    new AtsAdapter(source).normalize(payload);
    store.reviewDirectory({
      ...feed,
      id,
      company: source.company,
      aliases: existing?.aliases ?? [],
      reference: request.url,
      policyReference: request.policyUrl,
      policy: 'approved',
      verifiedAt: at.toISOString(),
      refreshAfter: new Date(at.getTime() + 30 * 86400000).toISOString(),
      responseHash: hash(body),
      ...(source.pageUrl ? { pageUrl: source.pageUrl } : {}),
    });
    const current = store.sources().find((s) => s.config.directoryId === id);
    if (current?.state.error === 'POLICY_REVIEW_REQUIRED')
      store.setState(current.config.id, {
        ...current.state,
        status: current.state.cursor ? 'INTERRUPTED' : 'NEVER_POLLED',
        nextPollAt: 0,
        error: null,
      });
  }
}
