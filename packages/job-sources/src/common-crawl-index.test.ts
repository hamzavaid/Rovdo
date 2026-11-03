import { it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readCommonCrawlIndex } from './common-crawl-index';
import type { DiscoveryRead } from './global-adapters';
import { readPublic } from '@rovdo/shared/network';
import { mkdir, writeFile } from 'node:fs/promises';
const index = 'https://index.commoncrawl.org/CC-MAIN-2026-43-index';
function fixture(count = 3) {
  let offset = 0;
  const blocks: Buffer[] = [];
  const rows = Array.from({ length: count }, (_, n) => {
    const name = `a${String(n).padStart(5, '0')}`;
    const key = `io,greenhouse,boards)/${name}`;
    const block = gzipSync(
      `${key} 20261001000000 ${JSON.stringify({ url: `http://boards.greenhouse.io/${name}`, status: '200' })}\n`,
    );
    const row = `${key} 20261001000000\tcdx-00000.gz\t${offset}\t${block.length}\t${n}\n`;
    offset += block.length;
    blocks.push(block);
    return row;
  });
  const directory = Buffer.from(rows.join('')),
    data = Buffer.concat(blocks);
  let requests = 0;
  const read: DiscoveryRead = async (url, headers) => {
    requests++;
    const [start, end] = headers!.range!.slice(6).split('-').map(Number) as [number, number];
    const bytes = url.endsWith('cluster.idx') ? directory : data;
    const last = Math.min(end, bytes.length - 1);
    return {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${last}/${bytes.length}` },
      body: bytes.subarray(start, last + 1),
    };
  };
  return { read, requests: () => requests };
}
it('reads one bounded gzip block and resumes by directory byte offset independently of results', async () => {
  const f = fixture();
  const first = await readCommonCrawlIndex(index, 'boards.greenhouse.io/a', undefined, f.read);
  expect(first.urls).toEqual(['http://boards.greenhouse.io/a00000']);
  expect(first.next).toMatchObject({ offset: expect.any(Number) });
  const second = await readCommonCrawlIndex(index, 'boards.greenhouse.io/a', first.next, f.read);
  expect(second.urls).toEqual(['http://boards.greenhouse.io/a00001']);
});
it('binary searches a multi-window directory without downloading it all', async () => {
  const f = fixture(3300);
  const page = await readCommonCrawlIndex(index, 'boards.greenhouse.io/a03299', undefined, f.read);
  expect(page.urls).toEqual(['http://boards.greenhouse.io/a03299']);
  expect(page.next).toBeNull();
  expect(f.requests()).toBeLessThan(12);
});
it('rejects ignored ranges, unsafe filenames and off-origin identities', async () => {
  await expect(
    readCommonCrawlIndex(index, 'boards.greenhouse.io/a', undefined, async () => ({
      status: 200,
      headers: {},
      body: Buffer.from('ignored range'),
    })),
  ).rejects.toThrow('RANGE_RESPONSE_INVALID');
  await expect(
    readCommonCrawlIndex(
      'https://private.example/index',
      'boards.greenhouse.io/a',
      undefined,
      async () => {
        throw new Error('must not read');
      },
    ),
  ).rejects.toThrow('INVALID_INDEX');
  const bytes = Buffer.from(
    'io,greenhouse,boards)/a 20261001000000\t../../private.gz\t0\t100\t1\n',
  );
  await expect(
    readCommonCrawlIndex(index, 'boards.greenhouse.io/a', undefined, async () => ({
      status: 206,
      headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
      body: bytes,
    })),
  ).rejects.toThrow('SCHEMA_DRIFT');
});
it('bounds decompression of a hostile index block', async () => {
  const block = gzipSync(Buffer.alloc(8_000_001, 97));
  const directory = Buffer.from(
    `io,greenhouse,boards)/a 20261001000000\tcdx-00000.gz\t0\t${block.length}\t1\n`,
  );
  await expect(
    readCommonCrawlIndex(index, 'boards.greenhouse.io/a', undefined, async (url) => {
      const bytes = url.endsWith('cluster.idx') ? directory : block;
      return {
        status: 206,
        headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
        body: bytes,
      };
    }),
  ).rejects.toThrow('INDEX_BLOCK_INVALID');
});
it.skipIf(process.env.ROVDO_CC_INDEX_LIVE !== '1')(
  'discovers actual employer URLs through public range reads without the CDX query server',
  async () => {
    const started = performance.now();
    const catalog = JSON.parse(
      (await readPublic('https://index.commoncrawl.org/collinfo.json')).body.toString('utf8'),
    );
    let requests = 0,
      bytes = 0,
      found = 0;
    let cursor: { offset: number } | null | undefined;
    const read: DiscoveryRead = async (url, headers) => {
      const result = await readPublic(url, headers ? { headers } : {});
      requests++;
      bytes += result.body.length;
      return result;
    };
    for (const host of [
      'job-boards.greenhouse.io/',
      'boards.greenhouse.io/',
      'jobs.ashbyhq.com/',
      'jobs.lever.co/',
    ]) {
      cursor = undefined;
      for (let n = 0; n < 3; n++) {
        const page = await readCommonCrawlIndex(catalog[0]['cdx-api'], host, cursor, read);
        found += page.urls.length;
        cursor = page.next;
        if (found || !cursor) break;
      }
      if (found) break;
    }
    await mkdir('docs/progress', { recursive: true });
    await writeFile(
      'docs/progress/common-crawl-direct-live.json',
      JSON.stringify({ requests, bytes, found, elapsedMs: performance.now() - started }, null, 2),
    );
    expect(found).toBeGreaterThan(0);
  },
  90000,
);
