import { expect, it } from 'vitest';
import { fetchDiscoveryPage, parseGithubListings, normalizeDiscoveryJob } from './global-adapters';
import type { PublicResponse } from '@rovdo/shared/network';
const read = async (url: string): Promise<PublicResponse> => ({
  status: 200,
  headers: {},
  body: Buffer.from(
    JSON.stringify({
      jobs: [
        {
          guid: 'a',
          title: 'Engineer',
          companyName: 'Beyond Directory',
          description: 'TypeScript required',
          applicationLink: 'https://himalayas.app/jobs/a',
          locationRestrictions: [],
          pubDate: 1700000000,
        },
      ],
      nextCursor: url.includes('cursor=') ? undefined : 'opaque-token',
    }),
  ),
});
it('paginates opaque public API cursors and preserves attribution/application URLs', async () => {
  const first = await fetchDiscoveryPage('himalayas', {}, read);
  expect(first.records[0]?.company).toBe('Beyond Directory');
  expect(first.next?.cursor).toBe('opaque-token');
  expect((await fetchDiscoveryPage('himalayas', first.next!, read)).next).toBeNull();
});
it('reads only application-column links from repository tables and keeps incomplete rows unverified', () => {
  const rows = parseGithubListings(
    '| Company | Role | Location | Application |\n| [Example](https://example.com) | Firmware Intern | NY | [Apply](https://jobs.lever.co/example/123) |',
  );
  expect(rows[0]?.url).toBe('https://jobs.lever.co/example/123');
  expect(rows[0]?.description).toBe('');
});
it('quarantines malformed rows individually rather than discarding a valid feed', async () => {
  const page = await fetchDiscoveryPage('remotive', {}, async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      JSON.stringify({
        jobs: [
          {
            title: 'Valid',
            company_name: 'Example',
            url: 'https://remotive.com/jobs/1',
            description: 'Python required',
          },
          {},
        ],
      }),
    ),
  }));
  expect(page.records).toHaveLength(1);
  expect(page.rejected).toBe(1);
  expect(
    normalizeDiscoveryJob(
      page.records[0]!,
      { id: '00000000-0000-4000-8000-000000000001', tenant: 'remotive' },
      '00000000-0000-4000-8000-000000000002',
      1,
    )?.discovery?.availability,
  ).toBe('unverified');
});

it('decodes RSS descriptions and posting dates without executing XML or visiting links', async () => {
  const page = await fetchDiscoveryPage('we-work-remotely', {}, async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      '<rss><channel><item><title>Example: Software Engineer</title><link>https://weworkremotely.com/jobs/1</link><description><![CDATA[Python required]]></description><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>',
    ),
  }));
  expect(page.records[0]).toMatchObject({
    company: 'Example',
    title: 'Software Engineer',
    description: 'Python required',
  });
  expect(page.records[0]?.postedAt).toContain('2026-10-20');
});

it('constrains board-specific indexes but leaves the open web index unrestricted', async () => {
  const read = async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      JSON.stringify({ results: [{ url: 'https://unrelated.example/job', title: 'Engineer' }] }),
    ),
  });
  expect(
    (
      await fetchDiscoveryPage(
        'built-in',
        { indexUrl: 'https://index.example/search', query: 'TypeScript' },
        read,
      )
    ).records,
  ).toHaveLength(0);
  expect(
    (
      await fetchDiscoveryPage(
        'web-index',
        { indexUrl: 'https://index.example/search', query: 'TypeScript' },
        read,
      )
    ).records,
  ).toHaveLength(1);
});
