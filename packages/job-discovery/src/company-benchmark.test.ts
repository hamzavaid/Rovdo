import { writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
/** Mock-only reproducible throughput baseline: 100 validated employers / 500 unique postings. */
import { it, expect } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
it('streams a bounded inventory with no total cap and reuses cached ATS responses', async () => {
  const store = new CareerStore(':memory:');
  store.saveCollectionScope({ version: 1, countries: ['US', 'CA', 'GB', 'DE'], origin: 'user' });
  let requests = 0;
  for (let i = 0; i < 100; i++) {
    const feed = { ats: 'lever', tenant: 'fixture' + i, region: 'global' };
    store.global.rememberCompany(
      feed,
      'Fixture ' + i,
      'https://jobs.lever.co/fixture' + i,
      Date.now(),
    );
    store.global.validateCompany(feed, Date.now());
  }
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      requests++;
      const tenant = new URL(url).pathname.split('/').at(-1)!;
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          url.endsWith('robots.txt')
            ? 'User-agent: *\nAllow: /'
            : JSON.stringify(
                Array.from({ length: 5 }, (_, i) => ({
                  id: tenant + '-' + i,
                  text: 'Engineer ' + i,
                  hostedUrl: 'https://jobs.lever.co/' + tenant + '/' + i,
                  descriptionPlain: 'TypeScript required',
                  categories: { location: 'Remote' },
                })),
              ),
        ),
      };
    },
  });
  try {
    const samples = [];
    for (let pass = 0; pass < 2; pass++) {
      const before = requests;
      const heap = process.memoryUsage().heapUsed;
      const cpu = process.cpuUsage();
      const delay = monitorEventLoopDelay({ resolution: 1 });
      delay.enable();
      const at = performance.now();
      let peakRss = process.memoryUsage().rss;
      const id = engine.start({ sourceIds: ['lever'], overrides: {} });
      for (let tick = 0; tick < 200 && store.global.run(id).status === 'running'; tick++) {
        await engine.tick();
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }
      expect(store.global.run(id).status).toBe('completed');
      expect(store.global.stats(id).jobs).toBe(500);
      delay.disable();
      const used = process.cpuUsage(cpu);
      const queryAt = performance.now();
      store.searchFiltered({
        query: '',
        company: '',
        workMode: 'all',
        savedOnly: false,
        includeExcluded: false,
      });
      const cachedQueryMs = performance.now() - queryAt;
      samples.push({
        kind: pass ? 'cached' : 'cold',
        ms: Math.round(performance.now() - at),
        requests: requests - before,
        peakRss,
        heapDelta: process.memoryUsage().heapUsed - heap,
        jobs: store.jobCount(),
        verifiedJobs: store.jobs().filter((j) => j.discovery?.availability === 'verified').length,
        cpuMs: (used.user + used.system) / 1000,
        maxEventLoopDelayMs: delay.max / 1e6,
        cachedQueryMs,
      });
    }
    expect(samples[1]!.requests).toBe(0);
    expect(store.jobCount()).toBe(500);
    if (process.env.ROVDO_BENCHMARK_OUTPUT)
      await writeFile(process.env.ROVDO_BENCHMARK_OUTPUT, JSON.stringify(samples, null, 2));
  } finally {
    await engine.shutdown();
    store.close();
  }
}, 30000);
