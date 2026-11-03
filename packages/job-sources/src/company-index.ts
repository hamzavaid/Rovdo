/** Public archive indexes provide company leads only. Live ATS reads establish availability. */
import { feedFromUrl } from './directory';
import { canonicalUrl } from './index';
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
export async function discoverBoardPage(
  id: string,
  p: Record<string, unknown>,
  read: DiscoveryRead,
): Promise<DiscoveryPage> {
  const target = Number(p.target ?? 0);
  if (!Number.isSafeInteger(target) || target < 0 || target >= patterns.length)
    throw new Error('INVALID_CURSOR');
  const get = async (url: string) => {
    const r = await read(url);
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
    const url = new URL('https://web.archive.org/cdx/search/cdx');
    for (const [k, v] of Object.entries({
      url: patterns[target]!,
      output: 'json',
      fl: 'original',
      filter: 'statuscode:200',
      limit: '500',
      showResumeKey: 'true',
      ...(p.resumeKey ? { resumeKey: String(p.resumeKey) } : {}),
    }))
      url.searchParams.set(k, v);
    const text = await get(url.href);
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
    if (resumeKey) next = { target, resumeKey };
  } else {
    let index = String(p.index ?? '');
    if (!index) {
      const collections = JSON.parse(await get('https://index.commoncrawl.org/collinfo.json')) as {
        ['cdx-api']: string;
      }[];
      index = collections[0]?.['cdx-api'] ?? '';
    }
    if (!/^https:\/\/index\.commoncrawl\.org\/CC-MAIN-\d{4}-\d{2}-index$/.test(index))
      throw new Error('SCHEMA_DRIFT');
    const page = Number(p.page ?? 0);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('INVALID_CURSOR');
    const url = new URL(index);
    url.searchParams.set('url', patterns[target]!);
    url.searchParams.set('output', 'json');
    url.searchParams.set('filter', 'status:200');
    url.searchParams.set('pageSize', '1');
    let pages = Number(p.pages ?? 0);
    if (!pages) {
      url.searchParams.set('showNumPages', 'true');
      const meta = JSON.parse(await get(url.href)) as { pages: number };
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
    if (page + 1 < pages) next = { target, index, pages, page: page + 1 };
  }
  if (!next && target + 1 < patterns.length) next = { target: target + 1 };
  const unique = new Map<string, string>();
  let rejected = malformed;
  for (const url of urls) {
    try {
      const canonical = canonicalUrl(url);
      const feed = feedFromUrl(canonical);
      unique.set(feed ? [feed.ats, feed.tenant, feed.region].join(':') : canonical, canonical);
    } catch {
      rejected++;
    }
  }
  return {
    records: [...unique.values()].map((url) => ({
      url,
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
