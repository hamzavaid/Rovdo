import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollectionActivity } from './CollectionActivity';
import type { DiscoveryViewSchema } from '@rovdo/shared';
import type { z } from 'zod';

const view = (status: 'running' | 'paused' | 'completed' | 'canceled') =>
  ({
    run: {
      id: 'fixture',
      status,
      reason: null,
      createdAt: 1,
      updatedAt: 1,
      profileVersion: null,
      queries: [],
      options: { sourceIds: [], overrides: {} },
    },
    plan: [],
    runs: [],
    listings: [],
    coverage: [
      {
        sourceId: 'lever',
        status: 'ready',
        requests: 2,
        records: 4,
        error: null,
        rejected: 0,
        updatedAt: 1,
      },
      {
        sourceId: 'wayback',
        status: 'blocked',
        requests: 1,
        records: 0,
        error: 'HTTP_504',
        rejected: 0,
        updatedAt: 1,
      },
    ],
    registry: [],
    companies: 2,
    jobs: 4,
    pending: 3,
    done: 2,
    listingCount: 6,
    filtered: 1,
  }) as z.infer<typeof DiscoveryViewSchema>;

it.each(['running', 'paused', 'completed', 'canceled'] as const)(
  'preserves %s collection state and accurate counters',
  (status) => {
    const html = renderToStaticMarkup(
      <CollectionActivity
        view={view(status)}
        busy={false}
        command={async () => {}}
        onHealth={() => {}}
      />,
    );
    expect(html).toContain('4 unique jobs collected');
    expect(html).toContain('2 sources checked');
    expect(html).toContain('1 source issues');
    expect(html).toContain('6 unresolved leads');
    expect(html).toContain('View Collection Health');
    expect(html).not.toContain('progressbar');
    expect(html.includes('collection-pulse')).toBe(status === 'running');
    expect(html.includes('>Stop<')).toBe(status === 'running');
    if (status === 'completed')
      expect(html).toContain('Collection finished with unavailable sources');
    else if (status !== 'running') expect(html).toContain(`Collection ${status}`);
  },
);
