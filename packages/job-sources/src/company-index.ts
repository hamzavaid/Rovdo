/** Public archive indexes provide company leads only. Live ATS reads establish availability. */
import { feedFromUrl } from './directory';
import { canonicalUrl } from './index';
import { readCommonCrawlIndex } from './common-crawl-index';
import type { DiscoveryRead, DiscoveryPage } from './global-adapters';
import { DiscoveryHttpError } from './global-adapters';
const patterns = [
  'job-boards.greenhouse.io/*',
  'boards.greenhouse.io/*',
  'jobs.lever.co/*',
  'jobs.eu.lever.co/*',
  'jobs.ashbyhq.com/*',
  'careers.smartrecruiters.com/*',
  'jobs.smartrecruiters.com/*',
];
// Tenant prefixes partition a potentially enormous host scan. Walk every allowed
// first character; these are resumable batches, not a cap on employers or jobs.
const prefixes = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
// The published catalog also contains year-only and year-range legacy collections.
const indexPattern = /^https:\/\/index\.commoncrawl\.org\/CC-MAIN-\d{4}(?:-\d{2}|-\d{4})?-index$/;
function transient(error: unknown): boolean {
  if (error instanceof DiscoveryHttpError) return [500, 502, 503, 504].includes(error.status);
  return (
    error instanceof Error &&
    (['TimeoutError', 'AbortError'].includes(error.name) ||
      ('code' in error && ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(String(error.code))))
  );
}
export async function discoverBoardPage(
  id: string,
  p: Record<string, unknown>,
  read: DiscoveryRead,
): Promise<DiscoveryPage> {
  const target = Number(p.target ?? 0);
  if (!Number.isSafeInteger(target) || target < 0 || target >= patterns.length)
    throw new Error('INVALID_CURSOR');
  // Old persisted cursors must finish their original query before partitioning.
  const legacy =
    p.partition === undefined &&
    ['target', 'index', 'pages', 'page', 'resumeKey'].some((k) => p[k] !== undefined);
  const partition = legacy ? null : Number(p.partition ?? 0);
  if (
    partition !== null &&
    (!Number.isSafeInteger(partition) || partition < 0 || partition >= prefixes.length)
  )
    throw new Error('INVALID_CURSOR');
  const pattern = patterns[target]!.replace(
    '*',
    partition === null ? '*' : prefixes[partition] + '*',
  );
  const cursor = partition === null ? {} : { partition };
  let collectionIndex = '';
  let scopeFinished = false;
  const get = async (url: string, empty = '') => {
    const r = await read(url);
    if (id === 'common-crawl' && r.status === 404 && empty) {
      // The CDX API uses 404 for a legitimate empty query, as well as missing endpoints.
      // Only its documented no-capture JSON response is safe to advance past.
      try {
        const data = JSON.parse(r.body.toString('utf8')) as { message?: unknown };
        if (typeof data.message === 'string' && /^No Captures found\b/i.test(data.message))
          return empty;
      } catch {
        /* Other 404s remain failures. */
      }
    }
    if (r.status !== 200) {
      const seconds = Number(r.headers['retry-after'] ?? 0);
      throw new DiscoveryHttpError(
        r.status,
        Number.isFinite(seconds) && seconds >= 0 ? Math.min(86400000, seconds * 1000) : 0,
      );
    }
    return r.body.toString('utf8');
  };
  let malformed = 0;
  let urls: string[] = [],
    next: Record<string, unknown> | null = null;
  if (id === 'wayback') {
    const paged = p.paged === true;
    const page = Number(p.page ?? 0);
    let pages: number | null = p.pages === undefined ? null : Number(p.pages);
    const failures = Number(p.pageFailures ?? 0);
    if (
      paged &&
      (!Number.isSafeInteger(page) ||
        page < 0 ||
        (pages !== null && (!Number.isSafeInteger(pages) || pages < 0)) ||
        !Number.isSafeInteger(failures) ||
        failures < 0 ||
        failures > 1)
    )
      throw new Error('INVALID_CURSOR');
    const url = new URL('https://web.archive.org/cdx/search/cdx');
    for (const [k, v] of Object.entries({
      url: paged ? patterns[target]!.slice(0, -1) : pattern.slice(0, -1),
      matchType: 'prefix',
      output: 'json',
      fl: 'original',
      ...(paged ? {} : { filter: 'statuscode:200' }),
      ...(paged
        ? { pageSize: '1' }
        : {
            limit: '500',
            showResumeKey: 'true',
            ...(p.resumeKey ? { resumeKey: String(p.resumeKey) } : {}),
          }),
    }))
      url.searchParams.set(k, v);
    let text: string;
    try {
      if (paged) {
        // Keep a stable canonical query layout for archive/CDN caches.
        url.search = '';
        url.searchParams.set('url', patterns[target]!.slice(0, -1));
        url.searchParams.set('matchType', 'prefix');
        if (pages === null) {
          const metadata = new URL(url);
          metadata.searchParams.set('showNumPages', 'true');
          metadata.searchParams.set('pageSize', '1');
          const count = (await get(metadata.href)).trim();
          if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)))
            throw new Error('SCHEMA_DRIFT');
          pages = Number(count);
        }
        if (pages && page >= pages) throw new Error('INVALID_CURSOR');
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', '1');
        url.searchParams.set('output', 'json');
        url.searchParams.set('fl', 'original');
        text = pages ? await get(url.href) : '[]';
      } else text = await get(url.href);
    } catch (error) {
      // One oversized/unavailable host must not stop all other ATS hosts.
      // The engine keeps this failed cursor instead of calling it empty coverage.
      if (!transient(error)) throw error;
      const continuation =
        !paged && !legacy
          ? { target, paged: true }
          : paged && pages !== null && page + 1 < pages && failures === 0
            ? { target, paged: true, pages, page: page + 1, pageFailures: 1 }
            : target + 1 < patterns.length
              ? { target: target + 1, paged: true }
              : null;
      if (!continuation) throw error;
      return {
        records: [],
        rejected: 0,
        next: continuation,
        warning: 'ARCHIVE_HOST_UNAVAILABLE',
        retryAfterMs: Math.max(60000, error instanceof DiscoveryHttpError ? error.retryAfterMs : 0),
      };
    }
    const boundary = text.lastIndexOf(']');
    if (boundary < 0) throw new Error('SCHEMA_DRIFT');
    const rows = JSON.parse(text.slice(0, boundary + 1)) as unknown;
    if (!Array.isArray(rows)) throw new Error('SCHEMA_DRIFT');
    // CDX JSON embeds an empty separator row and a final single-cell resume key.
    const separator = rows.findIndex((r) => Array.isArray(r) && r.length === 0);
    let resumeKey = text.slice(boundary + 1).trim();
    const data = separator < 0 ? rows : rows.slice(0, separator);
    if (separator >= 0) {
      const tail = rows[separator + 1];
      if (separator !== rows.length - 2 || !Array.isArray(tail) || typeof tail[0] !== 'string')
        throw new Error('SCHEMA_DRIFT');
      resumeKey = tail[0];
    }
    if (
      !data.every((r) => Array.isArray(r) && typeof r[0] === 'string') ||
      (data.length && data[0][0] !== 'original')
    )
      throw new Error('SCHEMA_DRIFT');
    urls = data.slice(1).map((r) => r[0] as string);
    if (paged) {
      scopeFinished = true;
      if (page + 1 < pages!) next = { target, paged: true, pages, page: page + 1, pageFailures: 0 };
      else if (target + 1 < patterns.length) next = { target: target + 1, paged: true };
    } else if (resumeKey) next = { target, ...cursor, resumeKey };
  } else {
    const collections = async (): Promise<string[]> => {
      const raw: unknown = JSON.parse(await get('https://index.commoncrawl.org/collinfo.json'));
      if (!Array.isArray(raw) || !raw.length) throw new Error('SCHEMA_DRIFT');
      const indexes = raw.map((row) =>
        typeof row === 'object' && row !== null && 'cdx-api' in row ? row['cdx-api'] : null,
      );
      if (
        !indexes.every(
          (value): value is string => typeof value === 'string' && indexPattern.test(value),
        )
      )
        throw new Error('SCHEMA_DRIFT');
      return [...new Set(indexes)].sort().reverse();
    };
    let index = String(p.index ?? '');
    if (!index) {
      index = (await collections())[0]!;
    }
    if (!indexPattern.test(index)) throw new Error('SCHEMA_DRIFT');
    collectionIndex = index;
    const page = Number(p.page ?? 0);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('INVALID_CURSOR');
    const url = new URL(index);
    url.searchParams.set('url', pattern.slice(0, -1));
    url.searchParams.set('matchType', 'prefix');
    url.searchParams.set('output', 'json');
    url.searchParams.set('fl', 'url');
    url.searchParams.set('filter', 'status:200');
    url.searchParams.set('pageSize', '1');
    let pages = Number(p.pages ?? 0);
    if (!Number.isSafeInteger(pages) || pages < 0) throw new Error('INVALID_CURSOR');
    try {
      if (p.direct) {
        // The directory can seek directly to a host. Stream its gzip blocks once,
        // rather than repeating binary searches for every tenant prefix.
        const result = await readCommonCrawlIndex(
          index,
          patterns[target]!.slice(0, -1),
          p.direct === true ? undefined : p.direct,
          read,
        );
        urls = result.urls;
        malformed += result.rejected;
        if (result.next) next = { target, ...cursor, index, direct: result.next };
        else {
          scopeFinished = true;
          if (target + 1 < patterns.length)
            next = { target: target + 1, partition: 0, index, direct: true };
        }
      } else {
        if (!pages) {
          url.searchParams.set('showNumPages', 'true');
          const meta = JSON.parse(await get(url.href, '{"pages":0}')) as { pages: number };
          pages = meta.pages;
          if (!Number.isSafeInteger(pages) || pages < 0) throw new Error('SCHEMA_DRIFT');
          url.searchParams.delete('showNumPages');
        }
        if (pages > 0) {
          url.searchParams.set('page', String(page));
          urls = (await get(url.href))
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .flatMap((line) => {
              try {
                const r = JSON.parse(line) as { url: unknown };
                if (typeof r.url !== 'string') throw new Error('SCHEMA_DRIFT');
                return [r.url];
              } catch {
                malformed++;
                return [];
              }
            });
        }
        if (page + 1 < pages) next = { target, ...cursor, index, pages, page: page + 1 };
      }
    } catch (error) {
      if (!transient(error)) throw error;
      if (!p.direct)
        return {
          records: [],
          rejected: 0,
          next: { target, ...cursor, index, direct: true },
          warning: 'ARCHIVE_INDEX_UNAVAILABLE',
          retryAfterMs: 0, // The direct reader uses a different origin; its own persisted cooldown still applies.
        };
      const available = await collections();
      const position = available.indexOf(index);
      const fallback = position < 0 ? undefined : available[position + 1];
      if (!fallback) throw error;
      return {
        records: [],
        rejected: 0,
        next: { target, ...cursor, index: fallback, page: 0 },
        warning: 'ARCHIVE_INDEX_UNAVAILABLE',
        retryAfterMs: Math.max(60000, error instanceof DiscoveryHttpError ? error.retryAfterMs : 0),
      };
    }
    // Exploratory sampling is bounded to one older collection, then the exact primary
    // partition walk resumes. Empty successful indexes are different from outages.
    const emptyScopes = Number(p.emptyScopes ?? 0);
    if (!Number.isSafeInteger(emptyScopes) || emptyScopes < 0) throw new Error('INVALID_CURSOR');
    if (p.returnIndex) {
      if (typeof p.returnIndex !== 'string' || !indexPattern.test(p.returnIndex))
        throw new Error('INVALID_CURSOR');
      if (next) next = { ...next, returnIndex: p.returnIndex };
      else {
        index = p.returnIndex;
        collectionIndex = index;
      }
    } else if (!urls.length && !next && !p.direct && partition !== null && emptyScopes >= 3) {
      const available = await collections();
      const older = available[available.indexOf(index) + 1];
      if (older && older !== index)
        next = { target, partition, index: older, returnIndex: index, page: 0 };
    }
    // Reuse the validated collection identity between partitions, not the old page count.
    if (!next && !scopeFinished && partition !== null && partition + 1 < prefixes.length)
      next = { target, partition: partition + 1, index };
    if (next && !p.returnIndex && !next.returnIndex && !urls.length && !p.direct)
      next = { ...next, emptyScopes: emptyScopes + 1 };
  }
  if (!next && !scopeFinished && partition !== null && partition + 1 < prefixes.length)
    next = { target, partition: partition + 1 };
  if (!next && !scopeFinished && target + 1 < patterns.length)
    next = {
      target: target + 1,
      ...(partition === null
        ? {}
        : { partition: 0, ...(collectionIndex ? { index: collectionIndex } : {}) }),
    };
  const unique = new Map<string, { url: string; original: string }>();
  let rejected = malformed;
  for (const url of urls) {
    try {
      const historical = new URL(url);
      // Only recognized public ATS hosts may be upgraded. No HTTP request is sent.
      if (
        historical.protocol === 'http:' &&
        !historical.port &&
        !historical.username &&
        !historical.password
      ) {
        historical.protocol = 'https:';
        if (!feedFromUrl(canonicalUrl(historical.href))) throw new Error('INVALID_JOB_URL');
      }
      const canonical = canonicalUrl(historical.href);
      const feed = feedFromUrl(canonical);
      const key = feed ? [feed.ats, feed.tenant, feed.region].join(':') : canonical;
      if (!unique.has(key)) unique.set(key, { url: canonical, original: url });
    } catch {
      rejected++;
    }
  }
  return {
    rawRecords: urls.length,
    records: [...unique.values()].map(({ url, original }) => ({
      url,
      companyEvidence: `Archive URL: ${original}`.slice(0, 500),
      title: 'Discovered employer board',
      company: null,
      description: '',
      location: '',
      postedAt: null,
      employmentType: 'unknown',
      workMode: 'unknown',
      requisitionId: null,
      salary: null,
      sourceId: id,
      sourceName: id,
      sourceUrl:
        id === 'wayback'
          ? 'https://web.archive.org/cdx/search/cdx'
          : 'https://index.commoncrawl.org/',
      kind: 'index',
      exportAllowed: true,
    })),
    next,
    rejected,
  };
}
