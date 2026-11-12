import { it, expect } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
import { vi } from 'vitest';

it.each(['wayback', 'common-crawl'])(
  'retains failed %s checkpoints and still collects from a succeeding archive scope',
  async (sourceId) => {
    const store = new CareerStore(':memory:');
    store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
    const latest = 'https://index.commoncrawl.org/CC-MAIN-2026-43-index';
    const older = 'https://index.commoncrawl.org/CC-MAIN-2026-39-index';
    const engine = new GlobalDiscoveryEngine(store, {
      lane: 'companies',
      sleep: async () => {},
      transport: async (url) => {
        let data: unknown;
        let status = 200;
        if (url.endsWith('/collinfo.json')) data = [{ 'cdx-api': latest }, { 'cdx-api': older }];
        else if (url.startsWith('https://data.commoncrawl.org/')) {
          data = '';
          status = 503;
        } else if (url.startsWith(latest)) {
          data = 'Gateway timeout';
          status = 504;
        } else if (url.startsWith(older))
          data = url.includes('showNumPages')
            ? { pages: 1 }
            : JSON.stringify({ url: 'http://boards.greenhouse.io/recovered/jobs/deleted' });
        else if (url.includes('web.archive.org')) {
          const params = new URL(url).searchParams;
          if (params.has('showNumPages')) data = '2';
          else if (params.get('page') === '1')
            data = [['original'], ['http://boards.greenhouse.io/recovered/jobs/deleted']];
          else if (params.get('url')?.startsWith('job-boards.greenhouse.io/')) {
            status = 503;
            data = '';
          } else data = [['original'], ['http://boards.greenhouse.io/recovered/jobs/deleted']];
        } else if (url.endsWith('/boards/recovered')) data = { name: 'Recovered Employer' };
        else if (url.includes('/boards/recovered/jobs'))
          data = {
            jobs: [
              {
                id: 1,
                title: 'Engineer',
                content: 'TypeScript required.',
                location: { name: 'Remote' },
                absolute_url: 'https://job-boards.greenhouse.io/recovered/jobs/1',
              },
            ],
          };
        else throw new Error('Unexpected request');
        return {
          status,
          headers: {},
          body: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
        };
      },
    });
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      const id = engine.start({ sourceIds: [sourceId, 'greenhouse'], overrides: {} });
      await engine.tick();
      expect(store.global.coverage(id).find((s) => s.sourceId === sourceId)?.status).toBe(
        'partial',
      );
      expect(
        store.global.ready(id, Date.now(), 100).filter((t) => t.sourceId === sourceId),
      ).toHaveLength(sourceId === 'common-crawl' ? 1 : 0);
      vi.setSystemTime(Date.now() + 61000);
      for (let i = 0; i < 12; i++) {
        vi.setSystemTime(Date.now() + 61000);
        await engine.tick();
      }
      expect(store.jobs()).toHaveLength(1);
      expect(store.jobs()[0]!.company).toBe('Recovered Employer');
      expect(store.global.coverage(id).find((s) => s.sourceId === sourceId)).toMatchObject({
        status: 'partial',
        error: sourceId === 'wayback' ? 'ARCHIVE_HOST_UNAVAILABLE' : 'ARCHIVE_INDEX_UNAVAILABLE',
      });
    } finally {
      vi.useRealTimers();
      await engine.shutdown();
      store.close();
    }
  },
);

it('turns a historical unnamed Greenhouse URL into a named live employer through board metadata', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
  const seen: string[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    lane: 'companies',
    sleep: async () => {},
    transport: async (url) => {
      seen.push(url);
      let body: unknown;
      if (url.includes('web.archive.org'))
        body = [['original'], ['http://boards.greenhouse.io/realco/jobs/deleted']];
      else if (url === 'https://boards-api.greenhouse.io/v1/boards/realco')
        body = { name: 'Real Company' };
      else if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/realco/jobs'))
        body = {
          jobs: [
            {
              id: 1,
              title: 'Engineer',
              location: { name: 'Remote' },
              content: 'TypeScript required.',
              absolute_url: 'https://job-boards.greenhouse.io/realco/jobs/1',
            },
          ],
        };
      else throw new Error('Unexpected network destination');
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) };
    },
  });
  try {
    engine.start({ sourceIds: ['wayback', 'greenhouse'], overrides: {} });
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(store.jobs()).toHaveLength(1);
    expect(store.jobs()[0]).toMatchObject({
      company: 'Real Company',
      discovery: { availability: 'verified', sourceUrl: 'https://boards.greenhouse.io/realco' },
    });
    expect(seen.some((url) => url.includes('/jobs/deleted'))).toBe(false);
    expect(store.global.companyBatch('', 10)[0]).toMatchObject({
      company: 'Real Company',
      ats: 'greenhouse',
    });
  } finally {
    await engine.shutdown();
    store.close();
  }
});
