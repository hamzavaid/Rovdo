/** Opt-in read-only operational smoke check. Ordinary CI remains entirely offline. */
import { it, expect } from 'vitest';
import { readPublic } from '@rovdo/shared/network';
import { fetchDiscoveryPage } from './global-adapters';

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
