/** Opt-in read-only operational smoke check. Ordinary CI remains entirely offline. */
import { it, expect } from 'vitest';
import { readPublic } from '@rovdo/shared/network';
import { fetchDiscoveryPage } from './global-adapters';
import { mkdir, writeFile } from 'node:fs/promises';

it.skipIf(process.env.ROVDO_DISCOVERY_LIVE !== '1')(
  'reads and parses a real independent public feed using the production transport',
  async () => {
    const page = await fetchDiscoveryPage('remotive', {}, (url, headers) =>
      readPublic(url, headers ? { headers } : {}),
    );
    expect(page.records.length).toBeGreaterThan(0);
    expect(
      page.records.every((r) => r.company && r.description && r.url.startsWith('https://')),
    ).toBe(true);
  },
  20000,
);
it.skipIf(process.env.ROVDO_WAYBACK_LIVE !== '1')(
  'reads real employer leads from Wayback native index pages',
  async () => {
    let requests = 0,
      bytes = 0;
    const start = performance.now();
    const page = await fetchDiscoveryPage(
      'wayback',
      { paged: true, target: 2, page: 1, pages: 419 },
      async (url, headers) => {
        const r = await readPublic(url, { ...(headers ? { headers } : {}), timeoutMs: 30000 });
        requests++;
        bytes += r.body.length;
        return r;
      },
    );
    await mkdir('docs/progress', { recursive: true });
    await writeFile(
      'docs/progress/wayback-native-live.json',
      JSON.stringify(
        {
          requests,
          bytes,
          leads: page.records.length,
          next: page.next,
          elapsedMs: performance.now() - start,
        },
        null,
        2,
      ),
    );
    expect(page.records.length).toBeGreaterThan(0);
    expect(page.next).toMatchObject({ paged: true, page: 2 });
  },
  60000,
);
