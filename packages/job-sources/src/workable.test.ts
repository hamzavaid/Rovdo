import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { SourceConfigSchema } from '@rovdo/shared';
import type { SourceState } from '@rovdo/shared';
import { AtsAdapter, feedFromUrl, sourceEndpoint } from './index';

const source = () =>
  SourceConfigSchema.parse({
    id: randomUUID(),
    ats: 'workable',
    tenant: 'fixture',
    company: 'Fixture',
    enabled: true,
    region: 'global',
    intervalMs: 86400000,
    termsReviewedAt: '2026-11-15T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 2,
  });
const state = { cursor: null, etag: null, lastModified: null } as SourceState;
const signal = () => new AbortController().signal;
const posting = (shortcode = 'ABC123') => ({
  shortcode,
  title: 'Museum Conservator',
  employment_type: 'Full-time',
  telecommuting: true,
  url: `https://apply.workable.com/j/${shortcode}`,
  published_on: '2026-11-01',
  country: 'United States',
  city: 'Boston',
  state: 'MA',
  locations: [
    { country: 'United States', countryCode: 'US', city: 'Boston', region: 'MA', hidden: false },
    { country: 'Canada', countryCode: 'CA', city: 'Toronto', region: 'Ontario', hidden: false },
  ],
  description: '<p>Conservation experience required.</p>',
});
it('recognizes exact board roots, rejects API/shortlink routes and constructs only the public GET', () => {
  expect(feedFromUrl('https://apply.workable.com/fixture/')).toEqual({
    ats: 'workable',
    tenant: 'fixture',
    region: 'global',
  });
  for (const url of [
    'https://apply.workable.com.attacker.test/fixture',
    'https://apply.workable.com/api/v1/widget/accounts/fixture',
    'https://apply.workable.com/j/ABC123',
    'https://apply.workable.com/fixture?next=evil',
  ])
    expect(feedFromUrl(url)).toBeNull();
  expect(sourceEndpoint(source())).toBe(
    'https://apply.workable.com/api/v1/widget/accounts/fixture?details=true',
  );
});
it('preserves stable IDs, descriptions, location restrictions and per-row quarantine', async () => {
  const adapter = new AtsAdapter(source(), async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify({ name: 'Fixture', jobs: [posting(), {}] })),
  }));
  const page = await adapter.fetchPage(state, signal());
  expect(page).toMatchObject({ returned: 2, nextCursor: null, status: 200 });
  expect(page.quarantine).toHaveLength(1);
  expect(page.jobs).toHaveLength(1);
  expect(page.jobs[0]).toMatchObject({
    id: 'workable:fixture:ABC123',
    sourceJobId: 'ABC123',
    canonicalUrl: 'https://apply.workable.com/j/ABC123',
    descriptionText: 'Conservation experience required.',
    workMode: 'remote',
    activeStatus: 'open',
    details: { country: 'US', remoteJurisdiction: expect.arrayContaining(['US', 'CA']) },
  });
  expect(await adapter.verifyActive(page.jobs[0]!, signal())).toBe('open');
});
it('honors conditional refresh and empty boards without accepting schema drift as absence', async () => {
  const requests: { url: string; headers: unknown }[] = [];
  let body: unknown = { name: 'Fixture', jobs: [] };
  let status = 200;
  const adapter = new AtsAdapter(source(), async (url, options) => {
    if (url.endsWith('/robots.txt'))
      return { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow:') };
    requests.push({ url, headers: options?.headers });
    return { status, headers: { etag: 'version' }, body: Buffer.from(JSON.stringify(body)) };
  });
  expect(await adapter.fetchPage(state, signal())).toMatchObject({
    returned: 0,
    jobs: [],
    nextCursor: null,
  });
  status = 304;
  expect(await adapter.fetchPage({ ...state, etag: 'version' }, signal())).toMatchObject({
    status: 304,
    returned: 0,
  });
  expect(requests.at(-1)?.headers).toEqual({ 'if-none-match': 'version' });
  status = 200;
  for (body of [{ jobs: [{}] }, { unexpected: [] }, { jobs: 'changed' }])
    await expect(adapter.fetchPage(state, signal())).rejects.toThrow('SCHEMA_DRIFT');
  await expect(adapter.fetchPage({ ...state, cursor: '20' }, signal())).rejects.toThrow(
    'INVALID_CURSOR',
  );
});
it('rejects off-host job links and preserves HTTP failures, throttling and cancellation', async () => {
  const adapter = new AtsAdapter(source(), async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      JSON.stringify({ jobs: [posting(), { ...posting('BAD'), url: 'https://evil.test/j/BAD' }] }),
    ),
  }));
  const page = await adapter.fetchPage(state, signal());
  expect(page.jobs).toHaveLength(1);
  expect(page.quarantine).toHaveLength(1);
  const failed = new AtsAdapter(source(), async (url) =>
    url.endsWith('/robots.txt')
      ? { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow:') }
      : { status: 429, headers: { 'retry-after': '60' }, body: Buffer.alloc(0) },
  );
  await expect(failed.fetchPage(state, signal())).rejects.toMatchObject({
    status: 429,
    retryAfterMs: 60000,
  });
  const controller = new AbortController();
  controller.abort();
  await expect(adapter.fetchPage(state, controller.signal)).rejects.toThrow();
});
it('returns the entire published inventory without inventing a server pagination cursor', async () => {
  const jobs = Array.from({ length: 121 }, (_, i) => posting(`JOB${i}`));
  const adapter = new AtsAdapter(source(), async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify({ jobs })),
  }));
  expect(await adapter.fetchPage(state, signal())).toMatchObject({
    returned: 121,
    nextCursor: null,
    jobs: expect.any(Array),
  });
  expect(adapter.normalize({ jobs })).toHaveLength(121);
});
it('fails closed on denied robots policy and does not read the feed', async () => {
  const urls: string[] = [];
  const adapter = new AtsAdapter(source(), async (url) => {
    urls.push(url);
    return { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow: /api') };
  });
  await expect(adapter.fetchPage(state, signal())).rejects.toThrow('ROBOTS_BLOCKED');
  expect(urls).toEqual(['https://apply.workable.com/robots.txt']);
});
