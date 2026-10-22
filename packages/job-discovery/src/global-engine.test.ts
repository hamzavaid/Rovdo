import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import type { PublicResponse } from '@rovdo/shared/network';
import { DiscoveryPolicyError } from '@rovdo/job-sources';
import { sampleCandidate } from '../../../tests/fixtures/ranking-v2';
it('reuses shared search criteria and stops all queued source queries when JobSpy is unavailable', async () => {
  const store = new CareerStore(':memory:');
  store.saveProfile(sampleCandidate());
  store.setJobSpySettings({ enabled: true, riskAccepted: true });
  const received: Record<string, unknown>[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    jobspy: async (_id, payload) => {
      received.push(payload);
      throw new DiscoveryPolicyError('JOBSPY_UNAVAILABLE');
    },
  });
  try {
    const id = engine.start({
      sourceIds: ['linkedin-jobs'],
      overrides: { 'linkedin-jobs': { keywords: 'Stale keywords', location: 'Stale location' } },
      filters: {
        keywords: 'Firmware engineer',
        location: 'Los Angeles',
        workMode: 'remote',
        employmentType: 'internship',
        freshnessDays: 7,
      },
    });
    await engine.tick();
    await engine.tick();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      query: expect.stringContaining('Firmware engineer'),
      location: 'Los Angeles',
      workMode: 'remote',
      employmentType: 'internship',
      freshnessDays: 7,
    });
    expect(String(received[0]!.query)).not.toContain('Stale keywords');
    expect(store.global.stats(id).pending).toBe(0);
    expect(store.global.run(id).status).toBe('completed');
    expect(store.global.coverage(id)[0]!.error).toBe('JOBSPY_UNAVAILABLE');
  } finally {
    await engine.shutdown();
    store.close();
  }
});
const response = (raw: unknown, status = 200): PublicResponse => ({
  status,
  headers: {},
  body: Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw)),
});
it('only runs selected JobSpy sources after opt-in, retains checkpoints and preserves scoring', async () => {
  const store = new CareerStore(':memory:');
  let calls = 0;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    jobspy: async (id, payload) => {
      calls++;
      expect(payload.query).toBeTruthy();
      expect(id).toBe('linkedin-jobs');
      return {
        records: [
          {
            url: 'https://jobs.example.com/engineering',
            title: 'Engineer',
            company: 'Example',
            description: 'TypeScript required',
            location: 'Remote',
            postedAt: null,
            employmentType: 'full-time',
            workMode: 'remote',
            requisitionId: null,
            salary: null,
            sourceId: id,
            sourceName: 'LinkedIn jobs',
            sourceUrl: 'https://www.linkedin.com/jobs/view/1',
            kind: 'aggregate',
            exportAllowed: true,
          },
        ],
        next: null,
        rejected: 0,
      };
    },
    transport: async () => response('User-agent: *\nDisallow: /'),
  });
  try {
    const disabled = engine.start({ sourceIds: ['linkedin-jobs'], overrides: {} });
    await engine.tick();
    expect(calls).toBe(0);
    expect(store.global.coverage(disabled)[0]!.status).toBe('disabled');
    store.setJobSpySettings({ enabled: true, riskAccepted: true });
    const id = engine.start({ sourceIds: ['linkedin-jobs'], overrides: {} });
    await engine.tick();
    expect(calls).toBe(1);
    expect(store.global.stats(id).jobs).toBe(1);
    expect(store.jobs()[0]!.source).toBe('jobspy');
    expect(store.jobs()[0]!.discovery?.availability).toBe('unverified');
    expect(engine.view().registry.find((s) => s.id === 'linkedin-jobs')!.status).toBe(
      'configuration',
    );
  } finally {
    await engine.shutdown();
    store.close();
  }
});
it('discovers an unsaved employer via an index, follows a supported ATS and scores without AI', async () => {
  const store = new CareerStore(':memory:');
  const urls: string[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      urls.push(url);
      if (url.startsWith('https://index.example/search'))
        return response({
          results: url.includes('pageno=2')
            ? []
            : [{ title: 'Engineer', url: 'https://jobs.lever.co/beyond/123' }],
        });
      if (url.includes('robots.txt')) return response('User-agent: *\nAllow: /');
      if (url.startsWith('https://jobs.lever.co/'))
        return response(
          '<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","description":"TypeScript required","url":"https://jobs.lever.co/beyond/123","hiringOrganization":{"name":"Beyond Directory"}}</script>',
        );
      if (url.startsWith('https://api.lever.co/'))
        return response([
          {
            id: '123',
            text: 'Engineer',
            hostedUrl: 'https://jobs.lever.co/beyond/123',
            descriptionPlain: 'TypeScript required',
            categories: { location: 'Remote' },
          },
        ]);
      throw new Error('unexpected');
    },
  });
  try {
    const id = engine.start({
      sourceIds: ['web-index', 'lever'],
      overrides: {},
      indexUrl: 'https://index.example/search',
    });
    for (let n = 0; n < 8; n++) await engine.tick();
    expect(store.jobCount()).toBe(1);
    expect(store.jobs()[0]!.company).toBe('Beyond Directory');
    expect(store.jobs()[0]!.discovery?.availability).toBe('verified');
    expect(store.directory()).toHaveLength(0);
    expect(store.global.stats(id).companies).toBe(1);
    expect(urls.some((u) => u.startsWith('https://api.lever.co/'))).toBe(true);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
it('isolates rate limits, refuses restricted pages, and recovers persisted paused runs', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => response({}, 429),
  });
  try {
    const id = engine.start({ sourceIds: ['himalayas'], overrides: {} });
    await engine.tick();
    expect(store.global.ready(id, Date.now())).toHaveLength(0);
    expect(store.global.coverage(id)[0]?.status).toBe('retrying');
    await engine.control(id, 'pause');
    expect(store.global.run(id).status).toBe('paused');
    await engine.control(id, 'resume');
    expect(store.global.run(id).status).toBe('running');
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('never fetches blocked platform pages and reports schema drift rather than looping indefinitely', async () => {
  const store = new CareerStore(':memory:');
  const seen: string[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      seen.push(url);
      return response(
        url.includes('pageno=2')
          ? { results: [] }
          : { results: [{ title: 'Unverified', url: 'https://www.linkedin.com/jobs/view/123' }] },
      );
    },
  });
  try {
    const id = engine.start({
      sourceIds: ['web-index'],
      overrides: {},
      indexUrl: 'https://index.example/search',
    });
    for (let i = 0; i < 4; i++) await engine.tick();
    expect(seen.every((s) => new URL(s).hostname === 'index.example')).toBe(true);
    expect(store.global.listings(id)[0]?.status).toBe('blocked');
    expect(store.jobCount()).toBe(0);
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('obeys robots exclusions and isolates a malformed provider from healthy feeds', async () => {
  const store = new CareerStore(':memory:');
  const seen: string[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      seen.push(url);
      if (url.includes('himalayas')) return response({ unexpected: true });
      if (url.includes('index.example'))
        return response({
          results: url.includes('pageno=2')
            ? []
            : [{ title: 'Engineer', url: 'https://careers.example/private/job' }],
        });
      if (url.endsWith('robots.txt')) return response('User-agent: *\nDisallow: /private');
      throw new Error('Policy bypass');
    },
  });
  try {
    const id = engine.start({
      sourceIds: ['web-index', 'himalayas'],
      overrides: {},
      indexUrl: 'https://index.example/search',
    });
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(seen).not.toContain('https://careers.example/private/job');
    expect(store.global.coverage(id).some((s) => s.error === 'SCHEMA_DRIFT')).toBe(true);
    expect(store.global.listings(id)[0]?.reason).toBe('ROBOTS_BLOCKED');
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('bounds transient retries and leaves source recovery available through a new search', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => {
      throw new Error('offline');
    },
  });
  try {
    const id = engine.start({ sourceIds: ['remotive'], overrides: {} });
    const task = store.global.ready(id, Date.now())[0]!;
    store.global.saveTask({ ...task, attempts: 4 });
    await engine.tick();
    expect(store.global.coverage(id)[0]?.status).toBe('blocked');
    expect(store.global.run(id).status).toBe('completed');
    const next = engine.start({ sourceIds: ['remotive'], overrides: {} });
    expect(next).not.toBe(id);
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('collects paginated jobs beyond starter employers and reuses cached feeds across idempotent searches', async () => {
  const store = new CareerStore(':memory:');
  let requests = 0;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => {
      requests++;
      return response({
        jobs: Array.from({ length: 205 }, (_, i) => ({
          url: `https://remotive.com/jobs/${i}`,
          title: `TypeScript Engineer ${i}`,
          company_name: `Employer ${i % 17}`,
          description: 'Required: TypeScript',
          candidate_required_location: 'Remote',
        })),
      });
    },
  });
  try {
    const options = { sourceIds: ['remotive'], overrides: {} };
    const first = engine.start(options);
    for (let i = 0; i < 3; i++) await engine.tick();
    expect(store.global.stats(first)).toMatchObject({ jobs: 205, companies: 17, pending: 0 });
    store.saveJob(store.jobs()[0]!.id, true);
    const second = engine.start(options);
    for (let i = 0; i < 3; i++) await engine.tick();
    expect(store.global.stats(second).jobs).toBe(205);
    expect(store.jobCount()).toBe(205);
    expect(requests).toBe(1);
    expect(store.savedIds()).toHaveLength(1);
    expect(
      store.sources().every((s) => s.config.collection === 'global' && !s.config.enabled),
    ).toBe(true);
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('quarantines a malformed JSON-LD posting without losing valid siblings', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      if (url.includes('index.example'))
        return response({
          results: url.includes('pageno=2')
            ? []
            : [{ title: 'Engineer', url: 'https://careers.example/jobs' }],
        });
      if (url.endsWith('robots.txt')) return response('User-agent: *\nAllow: /');
      return response(
        '<script type="application/ld+json">' +
          JSON.stringify([
            {
              '@type': 'JobPosting',
              title: 'Broken',
              hiringOrganization: { name: 'Example', url: 'https://careers.example' },
            },
            {
              '@type': 'JobPosting',
              title: 'Engineer',
              description: 'TypeScript required',
              url: 'https://careers.example/jobs/1',
              hiringOrganization: { name: 'Example', url: 'https://careers.example' },
            },
          ]) +
          '</script>',
      );
    },
  });
  try {
    engine.start({
      sourceIds: ['web-index'],
      overrides: {},
      indexUrl: 'https://index.example/search',
    });
    for (let i = 0; i < 4; i++) await engine.tick();
    expect(store.jobs().map((j) => j.title)).toEqual(['Engineer']);
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('does not retry redirects and shares terminal certificate failures across pages on an origin', async () => {
  const store = new CareerStore(':memory:');
  const seen: string[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      seen.push(url);
      if (url.includes('index.example'))
        return response({
          results: url.includes('pageno=2')
            ? []
            : [
                { title: 'A', url: 'https://broken.example/jobs/a' },
                { title: 'B', url: 'https://broken.example/jobs/b' },
                { title: 'Redirect', url: 'https://redirect.example/jobs/1' },
              ],
        });
      if (url.includes('broken.example'))
        throw Object.assign(new Error('private TLS detail'), { code: 'CERT_HAS_EXPIRED' });
      return response('', 302);
    },
  });
  try {
    const id = engine.start({
      sourceIds: ['web-index'],
      overrides: {},
      indexUrl: 'https://index.example/search',
    });
    for (let i = 0; i < 7; i++) await engine.tick();
    expect(seen.filter((u) => u.includes('broken.example'))).toHaveLength(1);
    expect(seen.filter((u) => u.includes('redirect.example'))).toHaveLength(1);
    expect(store.global.stats(id).pending).toBe(0);
    expect(
      store.global
        .coverage(id)
        .some((c) => c.error === 'TLS_CERTIFICATE_ERROR' || c.error === 'HTTP_302'),
    ).toBe(true);
  } finally {
    await engine.shutdown();
    store.close();
  }
});
