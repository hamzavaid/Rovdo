import { expect, it } from 'vitest';
import { discoverBoardPage } from './company-index';
it('samples an older published collection after repeated empty partitions and returns to the primary scan', async () => {
  const primary = 'https://index.commoncrawl.org/CC-MAIN-2026-43-index',
    older = 'https://index.commoncrawl.org/CC-MAIN-2026-38-index';
  const read = async (url: string) => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      url.endsWith('collinfo.json')
        ? JSON.stringify([{ 'cdx-api': primary }, { 'cdx-api': older }])
        : '{"pages":0}',
    ),
  });
  const page = await discoverBoardPage(
    'common-crawl',
    { index: primary, partition: 3, emptyScopes: 3 },
    read,
  );
  expect(page.next).toMatchObject({ index: older, returnIndex: primary });
  const sampled = await discoverBoardPage('common-crawl', page.next!, read);
  expect(sampled.next).toMatchObject({ index: primary, partition: 4 });
  expect(sampled.next).not.toHaveProperty('returnIndex');
});
