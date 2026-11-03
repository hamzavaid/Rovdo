import { it, expect } from 'vitest';
import { fetchDiscoveryPage } from './global-adapters';
it('partitions new archive scans by tenant prefix and preserves durable partition cursors', async () => {
  const urls: string[] = [];
  const page = await fetchDiscoveryPage('wayback', {}, async (url) => {
    urls.push(url);
    return { status: 200, headers: {}, body: Buffer.from('[["original"]]') };
  });
  expect(new URL(urls[0]!).searchParams.get('url')).toBe('job-boards.greenhouse.io/a*');
  expect(page.next).toMatchObject({ target: 0, partition: 1 });
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
