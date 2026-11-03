/** Bounded reader for Common Crawl's public ZipNum index when its query server is down.
 * Binary search transfers 64 KiB directory windows, then one gzip block per checkpoint.
 * Data remains historical URL evidence; only a subsequent live ATS read verifies jobs. */
import { gunzipSync } from 'node:zlib';
import { DiscoveryHttpError } from './global-adapters';
import type { DiscoveryRead } from './global-adapters';
const windowSize = 65536;
const hosts = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.eu.lever.co',
  'jobs.ashbyhq.com',
  'careers.smartrecruiters.com',
  'jobs.smartrecruiters.com',
]);
type Entry = { key: string; part: string; offset: number; length: number; next: number };
export async function readCommonCrawlIndex(
  index: string,
  prefix: string,
  cursor: unknown,
  read: DiscoveryRead,
): Promise<{ urls: string[]; rejected: number; next: { offset: number } | null }> {
  const collection =
    /^https:\/\/index\.commoncrawl\.org\/(CC-MAIN-\d{4}(?:-\d{2}|-\d{4})?)-index$/.exec(index)?.[1];
  if (!collection) throw new Error('INVALID_INDEX');
  const target = new URL(`https://${prefix}`);
  if (
    !hosts.has(target.hostname) ||
    target.port ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/[a-zA-Z0-9_-]{0,120}$/.test(target.pathname)
  )
    throw new Error('INVALID_INDEX');
  const lower =
    target.hostname.split('.').reverse().join(',') + ')' + target.pathname.toLowerCase();
  const upper = lower + '\uffff';
  const base = `https://data.commoncrawl.org/cc-index/collections/${collection}/indexes/`;
  const range = async (file: string, start: number, end: number) => {
    const r = await read(base + file, { range: `bytes=${start}-${end}` });
    if (r.status >= 300) throw new DiscoveryHttpError(r.status);
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers['content-range'] ?? '');
    const a = Number(m?.[1]),
      b = Number(m?.[2]),
      total = Number(m?.[3]);
    if (
      r.status !== 206 ||
      !m ||
      ![a, b, total].every(Number.isSafeInteger) ||
      a !== start ||
      b < a ||
      b !== Math.min(end, total - 1) ||
      total <= b ||
      r.body.length !== b - a + 1
    )
      throw new Error('RANGE_RESPONSE_INVALID');
    return { body: r.body, total };
  };
  const first = await range('cluster.idx', 0, windowSize - 1);
  const entries = async (start: number): Promise<Entry[]> => {
    const r = start === 0 ? first : await range('cluster.idx', start, start + windowSize - 1);
    if (r.total !== first.total) throw new Error('INDEX_CHANGED');
    const rows: Entry[] = [];
    const aligned =
      start === 0 ||
      (typeof cursor === 'object' &&
        cursor !== null &&
        'offset' in cursor &&
        cursor.offset === start);
    const newline = r.body.indexOf(10);
    if (!aligned && newline < 0) throw new Error('SCHEMA_DRIFT');
    let pos = aligned ? 0 : newline + 1;
    while (pos < r.body.length) {
      let end = r.body.indexOf(10, pos);
      if (end < 0) {
        if (start + r.body.length !== first.total) break;
        end = r.body.length;
      }
      const line = r.body.subarray(pos, end).toString('utf8').trim();
      if (line) {
        const [sort = '', part = '', rawOffset, rawLength] = line.split('\t');
        const key = sort.slice(0, sort.lastIndexOf(' '));
        const offset = Number(rawOffset),
          length = Number(rawLength);
        if (
          !key ||
          !/^cdx-\d{5}\.gz$/.test(part) ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(length) ||
          length < 1 ||
          length > 8_000_000 ||
          !Number.isSafeInteger(offset + length)
        )
          throw new Error('SCHEMA_DRIFT');
        rows.push({ key, part, offset, length, next: start + end + 1 });
      }
      pos = end + 1;
    }
    if (!rows.length) throw new Error('SCHEMA_DRIFT');
    return rows;
  };
  let entry: Entry;
  if (cursor !== undefined && cursor !== null) {
    const offset = typeof cursor === 'object' && 'offset' in cursor ? cursor.offset : NaN;
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= first.total
    )
      throw new Error('INVALID_CURSOR');
    entry = (await entries(offset))[0]!;
  } else {
    let lo = 0,
      hi = Math.ceil(first.total / windowSize) - 1,
      best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const rows = await entries(mid * windowSize);
      if (rows[0]!.key <= lower) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const rows = await entries(best * windowSize);
    entry = rows[0]!;
    for (const row of rows) {
      if (row.key > lower) break;
      entry = row;
    }
  }
  if (entry.key > upper) return { urls: [], rejected: 0, next: null };
  const compressed = await range(entry.part, entry.offset, entry.offset + entry.length - 1);
  let text: string;
  try {
    text = gunzipSync(compressed.body, { maxOutputLength: 8_000_000 }).toString('utf8');
  } catch {
    throw new Error('INDEX_BLOCK_INVALID');
  }
  const urls: string[] = [];
  let lastKey = entry.key,
    rejected = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const key = line.slice(0, line.indexOf(' '));
    if (key > lastKey) lastKey = key;
    if (!key.startsWith(lower)) continue;
    try {
      const raw: unknown = JSON.parse(line.slice(line.indexOf('{')));
      if (!raw || typeof raw !== 'object' || !('url' in raw) || typeof raw.url !== 'string')
        throw new Error('SCHEMA_DRIFT');
      if ('status' in raw && raw.status === '200') urls.push(raw.url);
    } catch {
      rejected++;
    }
  }
  return {
    urls,
    rejected,
    next: lastKey >= upper || entry.next >= first.total ? null : { offset: entry.next },
  };
}
