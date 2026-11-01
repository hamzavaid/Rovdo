/** Desired behavior for acquisition boundaries; all services are mocked and no AI is used. */
import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import { AtsAdapter, fetchDiscoveryPage, parseGithubListings } from '@rovdo/job-sources';
import { extractRequirements, unionMonths } from '@rovdo/career';
import { SourceStateSchema } from '@rovdo/shared';
import { jobSpyPage } from '../../../apps/desktop/src/main/jobspy';
it('separates versions from durations and uses minimum experience range bounds without inventing year-only months', () => {
  const p = extractRequirements(
    'Python 3 years of experience required\n3–5 years of experience required\nat least 3 years of experience required',
    'Backend Engineer',
  );
  expect(p.items.find((r) => r.kind === 'skill')!.versionRange).toBe(null);
  expect(p.items.filter((r) => r.kind === 'experience').map((r) => r.months)).toEqual([36, 36, 36]);
  expect(unionMonths([{ start: '2025', end: '2025' }], '2026-10-17')).toBe(0);
});
it('honors explicit JSON-LD expiration while preserving the record', () => {
  const store = new CareerStore(':memory:');
  try {
    const s = {
      ...store.globalSource('expiry', 'Fixture', 'https://jobs.example.com'),
      ats: 'jsonld' as const,
      pageUrl: 'https://jobs.example.com',
    };
    const adapter = new AtsAdapter(s);
    const [j] = adapter.normalize({
      jobs: [
        {
          title: 'Engineer',
          url: 'https://jobs.example.com/1',
          description: 'TypeScript required',
          validThrough: '2020-01-01T00:00:00Z',
        },
      ],
    });
    expect(j!.activeStatus).toBe('closed');
    expect(j!.validThrough).toBe('2020-01-01T00:00:00.000Z');
  } finally {
    store.close();
  }
});
it('does not manufacture JobSpy dates and treats Himalayas pubDate as an update', async () => {
  const page = jobSpyPage(
    'linkedin-jobs',
    [
      {
        job_url: 'https://www.linkedin.com/jobs/view/1',
        title: 'Engineer',
        company: 'Fixture',
        description: 'TypeScript',
        date_posted: '2026-02-30',
      },
    ],
    { query: 'Engineer', location: '', offset: 0 },
  );
  expect(page.records[0]!.postedAt).toBe(null);
  const feed = await fetchDiscoveryPage('himalayas', {}, async () => ({
    status: 200,
    headers: { 'x-rovdo-observed-at': '1' },
    body: Buffer.from(
      JSON.stringify({
        jobs: [
          {
            applicationLink: 'https://himalayas.app/jobs/1',
            title: 'Engineer',
            companyName: 'Fixture',
            description: 'TypeScript',
            pubDate: 1700000000,
          },
        ],
      }),
    ),
  }));
  expect(feed.records[0]!.postedAt).toBe(null);
  expect(feed.records[0]!.updatedAt).toBe('2023-11-14T22:13:20.000Z');
});
it('preserves cached observation timestamps and rechecks cooldowns established during quota waits', async () => {
  const store = new CareerStore(':memory:');
  const captured = Date.parse('2026-01-01T00:00:00Z');
  let calls = 0;
  store.global.putCache(
    'https://remotive.com/api/remote-jobs',
    {
      status: 200,
      headers: {},
      capturedAt: captured,
      body: Buffer.from(
        JSON.stringify({
          jobs: [
            {
              url: 'https://remotive.com/jobs/1',
              title: 'Engineer',
              company_name: 'Fixture',
              description: 'TypeScript',
            },
          ],
        }),
      ).toString('base64'),
    },
    Date.now() + 3600000,
  );
  const engine = new GlobalDiscoveryEngine(store, {
    transport: async () => {
      calls++;
      throw new Error('network must not run');
    },
  });
  try {
    engine.start({ sourceIds: ['remotive'], overrides: {} });
    await engine.tick();
    expect(store.jobs()[0]!.discovery!.checkedAt).toBe(captured);
    expect(calls).toBe(0);
  } finally {
    await engine.shutdown();
    store.close();
  }
  const other = new CareerStore(':memory:');
  other.reserveOrigin('https://remotive.com', Date.now() + 1000);
  const waiting = new GlobalDiscoveryEngine(other, {
    sleep: async () => {
      other.deferOrigin('https://remotive.com', Date.now() + 3600000);
    },
    transport: async () => {
      calls++;
      return { status: 200, headers: {}, body: Buffer.from('{"jobs":[]}') };
    },
  });
  try {
    waiting.start({ sourceIds: ['remotive'], overrides: {} });
    await waiting.tick();
    expect(calls).toBe(0);
  } finally {
    await waiting.shutdown();
    other.close();
  }
});
it('advances rejected pages to later valid records and detects a real cursor cycle', async () => {
  const store = new CareerStore(':memory:');
  let final = false;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      const u = new URL(url),
        cursor = u.searchParams.get('cursor');
      if (cursor === 'two') final = true;
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify(
            u.pathname.endsWith('/search')
              ? { jobs: [] }
              : cursor === 'two'
                ? {
                    jobs: [
                      {
                        applicationLink: 'https://himalayas.app/jobs/valid',
                        title: 'Engineer',
                        companyName: 'Fixture',
                        description: 'TypeScript',
                      },
                    ],
                  }
                : { jobs: [{ malformed: true }], nextCursor: cursor === 'one' ? 'two' : 'one' },
          ),
        ),
      };
    },
  });
  try {
    engine.start({ sourceIds: ['himalayas'], overrides: {} });
    for (let i = 0; i < 4; i++) await engine.tick();
    expect(final).toBe(true);
    expect(store.jobCount()).toBe(1);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
it('retains valid SmartRecruiters siblings when individual details are permanently unavailable', async () => {
  const store = new CareerStore(':memory:');
  try {
    const s = {
      ...store.globalSource('detail', 'Fixture', 'https://jobs.example.com'),
      ats: 'smartrecruiters' as const,
    };
    const adapter = new AtsAdapter(s, async (url) => ({
      status: url.endsWith('/2') ? 404 : 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify(
          url.includes('?')
            ? { content: [{ id: '1' }, { id: '2' }], totalFound: 2 }
            : {
                id: '1',
                name: 'Engineer',
                company: { identifier: s.tenant },
                jobAd: { sections: { jobDescription: { text: 'TypeScript required' } } },
              },
        ),
      ),
    }));
    const state = SourceStateSchema.parse(store.sources()[0]!.state);
    const p = await adapter.fetchPage(state, new AbortController().signal);
    expect(p.jobs).toHaveLength(1);
    expect(p.quarantine).toHaveLength(1);
    expect(p.quarantine![0]!.index).toBe(1);
    expect(p.returned).toBe(2);
  } finally {
    store.close();
  }
});
it.each(['invalid', 'date'])(
  'keeps SmartRecruiters transient detail retry metadata finite: %s',
  async (kind) => {
    const store = new CareerStore(':memory:');
    try {
      const source = {
        ...store.globalSource('retry-detail', 'Fixture', 'https://jobs.example.com'),
        ats: 'smartrecruiters' as const,
      };
      const adapter = new AtsAdapter(source, async (url) => ({
        status: url.includes('?') ? 200 : 429,
        headers: {
          'retry-after': kind === 'date' ? new Date(Date.now() + 60000).toUTCString() : 'invalid',
        },
        body: Buffer.from(JSON.stringify({ content: [{ id: '1' }], totalFound: 1 })),
      }));
      await expect(
        adapter.fetchPage(
          SourceStateSchema.parse(store.sources()[0]!.state),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: 'DETAIL_UNAVAILABLE',
        retryAfterMs: expect.toSatisfy((value: number) => Number.isFinite(value) && value >= 1000),
      });
    } finally {
      store.close();
    }
  },
);
it('inherits documented continuation employers and never treats URL substrings as a closed status', () => {
  const rows = parseGithubListings(
    '| Company | Role | Location | Application |\n| Fixture | Engineer | Remote | [Apply](https://jobs.lever.co/enclosed/1) |\n| ↳ | Data Engineer | Remote | [Apply](https://jobs.lever.co/enclosed/2) |',
  );
  expect(rows).toHaveLength(2);
  expect(rows[1]!.company).toBe('Fixture');
});
it('blocks actual repeated/alternating cursors even when all pages contain zero accepted jobs', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      const u = new URL(url);
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify(
            u.pathname.endsWith('/search')
              ? { jobs: [] }
              : { jobs: [], nextCursor: u.searchParams.get('cursor') === 'one' ? 'two' : 'one' },
          ),
        ),
      };
    },
  });
  try {
    const id = engine.start({ sourceIds: ['himalayas'], overrides: {} });
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(store.global.coverage(id).some((c) => c.error === 'NON_ADVANCING_PAGE')).toBe(true);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
