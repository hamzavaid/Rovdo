import { it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';
it('uses distinct cached ranges to resume Common Crawl blocks and validate two live employers', async () => {
  const store = new CareerStore(':memory:');
  let offset = 0;
  const blocks: Buffer[] = [];
  const directory = Buffer.from(
    ['acme', 'beta']
      .map((name) => {
        const key = `io,greenhouse,job-boards)/${name}`;
        const block = gzipSync(
          `${key} 20261001000000 ${JSON.stringify({ url: `http://job-boards.greenhouse.io/${name}/jobs/old`, status: '200' })}\n`,
        );
        const row = `${key} 20261001000000\tcdx-00000.gz\t${offset}\t${block.length}\t1\n`;
        blocks.push(block);
        offset += block.length;
        return row;
      })
      .join(''),
  );
  const data = Buffer.concat(blocks),
    ranges: string[] = [];
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url, options) => {
      if (url.endsWith('/collinfo.json'))
        return {
          status: 200,
          headers: {},
          body: Buffer.from('[{"cdx-api":"https://index.commoncrawl.org/CC-MAIN-2026-43-index"}]'),
        };
      if (url.includes('index.commoncrawl.org/CC-MAIN-'))
        return { status: 504, headers: {}, body: Buffer.from('Unavailable') };
      if (url.startsWith('https://data.commoncrawl.org/')) {
        const bytes = url.endsWith('cluster.idx') ? directory : data;
        const range = options!.headers!.range!;
        const [start, requested] = range.slice(6).split('-').map(Number) as [number, number];
        const end = Math.min(requested, bytes.length - 1);
        if (!url.endsWith('cluster.idx')) ranges.push(range);
        return {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
          body: bytes.subarray(start, end + 1),
        };
      }
      const u = new URL(url),
        name = u.pathname.split('/')[3]!;
      const body = u.pathname.endsWith('/jobs')
        ? {
            jobs: [
              {
                id: 1,
                title: 'Engineer',
                location: { name: 'Remote' },
                content: 'TypeScript required',
                absolute_url: `https://job-boards.greenhouse.io/${name}/jobs/1`,
              },
            ],
          }
        : { name };
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) };
    },
  });
  try {
    vi.useFakeTimers({ toFake: ['Date'] });
    engine.start({ sourceIds: ['common-crawl', 'greenhouse'], overrides: {} });
    for (let n = 0; n < 13 && store.jobCount() < 2; n++) {
      await engine.tick();
      vi.setSystemTime(Date.now() + 61000);
    }
    expect(
      store
        .jobs()
        .map((j) => j.company)
        .sort(),
    ).toEqual(['acme', 'beta']);
    expect(ranges).toHaveLength(2);
    expect(new Set(ranges).size).toBe(2);
    expect(store.jobs().every((j) => j.discovery?.availability === 'verified')).toBe(true);
  } finally {
    vi.useRealTimers();
    await engine.shutdown();
    store.close();
  }
});
