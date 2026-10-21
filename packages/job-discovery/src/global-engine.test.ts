import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import type { PublicResponse } from '@rovdo/shared/network';
const response = (raw: unknown, status = 200): PublicResponse => ({
  status,
  headers: {},
  body: Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw)),
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
