import { it, expect } from 'vitest';
import { fetchDiscoveryPage } from './global-adapters';
it('uses Wayback native block pagination with durable page counts', async () => {
  const seen: string[] = [];
  const page = await fetchDiscoveryPage(
    'wayback',
    { paged: true, target: 2, page: 1, pages: 419 },
    async (url) => {
      seen.push(url);
      return {
        status: 200,
        headers: {},
        body: Buffer.from('[["original"],["https://jobs.lever.co/acme/123"]]'),
      };
    },
  );
  const query = new URL(seen[0]!).searchParams;
  expect(query.get('url')).toBe('jobs.lever.co/');
  expect(query.get('page')).toBe('1');
  expect(query.get('pageSize')).toBe('1');
  expect(page.next).toMatchObject({ paged: true, page: 2, pages: 419 });
});
it('partitions new archive scans by tenant prefix and preserves durable partition cursors', async () => {
  const urls: string[] = [];
  const page = await fetchDiscoveryPage('wayback', {}, async (url) => {
    urls.push(url);
    return { status: 200, headers: {}, body: Buffer.from('[["original"]]') };
  });
  expect(new URL(urls[0]!).searchParams.get('url')).toBe('job-boards.greenhouse.io/a');
  expect(new URL(urls[0]!).searchParams.get('matchType')).toBe('prefix');
  expect(page.next).toMatchObject({ target: 0, partition: 1 });
});
it('preserves supported historical HTTP board leads without fetching HTTP or losing provenance', async () => {
  const page = await fetchDiscoveryPage('wayback', {}, async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      JSON.stringify([
        ['original'],
        ['http://boards.greenhouse.io:80/realco/jobs/expired?utm_source=archive'],
        ['https://boards.greenhouse.io/realco/jobs/other'],
        ['http://private.example/x'],
      ]),
    ),
  }));
  expect(page.records).toHaveLength(1);
  expect(page.records[0]!.url).toBe('https://boards.greenhouse.io/realco/jobs/expired');
  expect(page.records[0]!.companyEvidence).toContain(
    'http://boards.greenhouse.io:80/realco/jobs/expired',
  );
  expect(page.rejected).toBe(1);
});
it('checkpoints Common Crawl collection failover without treating a gateway error as empty coverage', async () => {
  const page = await fetchDiscoveryPage('common-crawl', {}, async (url) => ({
    status: url.endsWith('collinfo.json') ? 200 : 504,
    headers: {},
    body: Buffer.from(
      url.endsWith('collinfo.json')
        ? JSON.stringify([
            { 'cdx-api': 'https://index.commoncrawl.org/CC-MAIN-2026-43-index' },
            { 'cdx-api': 'https://index.commoncrawl.org/CC-MAIN-2026-38-index' },
            { 'cdx-api': 'https://index.commoncrawl.org/CC-MAIN-2012-index' },
            { 'cdx-api': 'https://index.commoncrawl.org/CC-MAIN-2008-2009-index' },
          ])
        : 'Gateway timeout',
    ),
  }));
  expect(page.next).toMatchObject({
    index: 'https://index.commoncrawl.org/CC-MAIN-2026-43-index',
    target: 0,
    partition: 0,
    direct: true,
  });
  expect(page).toMatchObject({ records: [], warning: 'ARCHIVE_INDEX_UNAVAILABLE' });
});
it('treats Common Crawl no-capture responses as an empty partition, not a broken source', async () => {
  const page = await fetchDiscoveryPage('common-crawl', {}, async (url) => ({
    status: url.endsWith('/collinfo.json') ? 200 : 404,
    headers: {},
    body: Buffer.from(
      url.endsWith('/collinfo.json')
        ? '[{"cdx-api":"https://index.commoncrawl.org/CC-MAIN-2026-43-index"}]'
        : '{"message":"No Captures found for: example"}',
    ),
  }));
  expect(page.records).toEqual([]);
  expect(page.next).toMatchObject({ target: 0, partition: 1 });
});
it('uses the latest fixed-origin Common Crawl index, advances empty pages and quarantines malformed lines', async () => {
  const urls: string[] = [];
  const page = await fetchDiscoveryPage('common-crawl', {}, async (url) => {
    urls.push(url);
    const u = new URL(url);
    const body =
      u.pathname === '/collinfo.json'
        ? JSON.stringify([{ 'cdx-api': 'https://index.commoncrawl.org/CC-MAIN-2026-43-index' }])
        : u.searchParams.has('showNumPages')
          ? JSON.stringify({ pages: 2 })
          : '{bad}\n' + JSON.stringify({ url: 'https://jobs.lever.co/example/123' });
    return { status: 200, headers: {}, body: Buffer.from(body) };
  });
  expect(page.records).toHaveLength(1);
  expect(page.rejected).toBe(1);
  expect(page.next).toMatchObject({
    page: 1,
    pages: 2,
    index: 'https://index.commoncrawl.org/CC-MAIN-2026-43-index',
  });
  expect(urls).toHaveLength(3);
  const empty = await fetchDiscoveryPage(
    'common-crawl',
    { target: 0, page: 1, pages: 2, index: 'https://index.commoncrawl.org/CC-MAIN-2026-43-index' },
    async () => ({ status: 200, headers: {}, body: Buffer.from('') }),
  );
  expect(empty.records).toHaveLength(0);
  expect(empty.next).toEqual({ target: 1 });
});
it('rejects an off-origin index identity before making a request', async () => {
  let requests = 0;
  await expect(
    fetchDiscoveryPage('common-crawl', { index: 'https://private.example/index' }, async () => {
      requests++;
      throw new Error('must not read');
    }),
  ).rejects.toThrow('SCHEMA_DRIFT');
  expect(requests).toBe(0);
});
it.each([403, 429])('does not evade HTTP %i restrictions through another index', async (status) => {
  let requests = 0;
  await expect(
    fetchDiscoveryPage(
      'common-crawl',
      { index: 'https://index.commoncrawl.org/CC-MAIN-2026-43-index' },
      async () => {
        requests++;
        return { status, headers: {}, body: Buffer.from('Restricted') };
      },
    ),
  ).rejects.toMatchObject({ status });
  expect(requests).toBe(1);
});
