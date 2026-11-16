import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter, installStarterDirectory } from '@rovdo/job-sources';
import { DiscoveryEngine, GlobalDiscoveryEngine } from './index';

const board = 'https://apply.workable.com/fixture';
const row = (shortcode: string, country: string, telecommuting = false) => ({
  shortcode,
  title: 'Museum Conservator',
  description: '<p>Conservation experience required.</p>',
  url: `https://apply.workable.com/j/${shortcode}`,
  country,
  telecommuting,
  employment_type: 'Full-time',
  published_on: '2026-11-01',
});
it('installs, collects, scopes and replays Workable inventory without losing history', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US'], origin: 'user' });
  await installStarterDirectory(
    {
      version: 1,
      releasedAt: '2026-11-15T00:00:00Z',
      employers: [
        {
          id: 'fixture',
          name: 'Fixture Museum',
          aliases: [],
          categories: ['culture'],
          referenceSets: [{ id: 'broader', edition: 'fixture' }],
          boards: [{ url: board, adapter: 'workable' }],
          provenance: [{ url: board, checkedAt: '2026-11-15T00:00:00Z' }],
        },
      ],
    },
    store,
  );
  let requests = 0;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      expect(new URL(url).hostname).toBe('apply.workable.com');
      requests++;
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify({
            name: 'Fixture Museum',
            jobs: [row('US1', 'United States'), row('CA1', 'Canada'), row('REMOTE', '', true)],
          }),
        ),
      };
    },
  });
  const collect = async () => {
    const id = engine.start({ sourceIds: ['workable'], overrides: {} });
    for (let i = 0; i < 20 && store.global.run(id).status === 'running'; i++) await engine.tick();
    expect(store.global.run(id).status).toBe('completed');
    return id;
  };
  try {
    const id = await collect();
    expect(store.global.stats(id).jobs).toBe(2);
    expect(
      store
        .jobs()
        .map((j) => j.sourceJobId)
        .sort(),
    ).toEqual(['REMOTE', 'US1']);
    const saved = store.jobs()[0]!;
    store.saveJob(saved.id, true);
    const before = requests;
    store.saveCollectionScope({ version: 1, countries: ['US', 'CA'], origin: 'user' });
    await collect();
    expect(
      store
        .jobs()
        .map((j) => j.sourceJobId)
        .sort(),
    ).toEqual(['CA1', 'REMOTE', 'US1']);
    expect(requests).toBe(before);
    expect(store.savedIds()).toContain(saved.id);
    expect(store.global.companyPage({ provider: 'workable' }).rows[0]).toMatchObject({
      ats: 'workable',
      complete: true,
    });
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('keeps removed postings through the grace policy and never closes history on malformed/304 boards', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US'], origin: 'user' });
  const config = {
    id: randomUUID(),
    ats: 'workable' as const,
    tenant: 'fixture',
    company: 'Fixture',
    enabled: true,
    region: 'global' as const,
    intervalMs: 60000,
    termsReviewedAt: '2026-11-15T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 2,
  };
  // Parse through the existing storage boundary; a cast must not bypass source validation.
  store.saveSource(config);
  let now = Date.now(),
    status = 200;
  let jobs: unknown[] = [row('KEEP', 'United States')];
  const engine = new DiscoveryEngine(
    store,
    (source) =>
      new AtsAdapter(source, async (url) =>
        url.endsWith('/robots.txt')
          ? { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow:') }
          : { status, headers: { etag: 'v1' }, body: Buffer.from(JSON.stringify({ jobs })) },
      ),
    { sleep: async () => {}, now: () => now, random: () => 0 },
  );
  const poll = async () => {
    now += 60001;
    await engine.poll(config.id);
  };
  try {
    await poll();
    expect(store.jobs()[0]?.activeStatus).toBe('open');
    jobs = [{}];
    await poll();
    expect(store.sources().find((source) => source.config.id === config.id)?.state.status).toBe(
      'FAILED_SOURCE',
    );
    expect(store.jobs()[0]?.activeStatus).toBe('open');
    status = 304;
    await poll();
    expect(store.jobs()[0]?.activeStatus).toBe('open');
    status = 200;
    jobs = [];
    await poll();
    expect(store.jobs()[0]?.activeStatus).toBe('open');
    await poll();
    expect(store.jobs()[0]?.activeStatus).toBe('unknown');
    expect(store.jobCount()).toBe(1);
    expect(store.global.board('workable:fixture:global')).toMatchObject({ pageUrl: board });
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('paginates Workable company inventory independently of other board families', () => {
  const store = new CareerStore(':memory:');
  try {
    for (let i = 0; i < 31; i++) {
      const tenant = `fixture-${String(i).padStart(2, '0')}`;
      store.global.rememberCompany(
        { ats: 'workable', tenant, region: 'global' },
        tenant,
        `https://apply.workable.com/${tenant}`,
        1,
      );
    }
    store.global.rememberCompany(
      { ats: 'lever', tenant: 'other', region: 'global' },
      'Other',
      'https://jobs.lever.co/other',
      1,
    );
    const first = store.global.companyPage({ provider: 'workable', limit: 25 });
    const next = store.global.companyPage({ provider: 'workable', limit: 25, offset: 25 });
    expect(first.total).toBe(31);
    expect(first.rows).toHaveLength(25);
    expect(next.rows).toHaveLength(6);
    expect(new Set([...first.rows, ...next.rows].map((b) => b.identity)).size).toBe(31);
    expect([...first.rows, ...next.rows].every((b) => b.ats === 'workable')).toBe(true);
  } finally {
    store.close();
  }
});
