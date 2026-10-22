import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalDiscovery } from './GlobalDiscovery';
import { DiscoveryViewSchema } from '@rovdo/shared';
it('shows inherited JobSpy criteria without duplicate inputs and explains missing dependencies', () => {
  const options = { sourceIds: ['linkedin-jobs'], overrides: {} };
  const view = DiscoveryViewSchema.parse({
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
      profileVersion: null,
      queries: ['Firmware'],
      options,
      reason: null,
    },
    runs: [],
    registry: [
      {
        id: 'linkedin-jobs',
        name: 'LinkedIn Jobs',
        url: 'https://www.linkedin.com/jobs',
        policyUrl: 'https://www.linkedin.com/jobs',
        adapter: 'jobspy',
        mode: 'scraper',
        status: 'configuration',
        limitation: 'Optional worker',
      },
    ],
    coverage: [
      {
        sourceId: 'linkedin-jobs',
        status: 'blocked',
        requests: 0,
        records: 0,
        rejected: 0,
        error: 'JOBSPY_UNAVAILABLE',
        updatedAt: 1,
      },
    ],
    listings: [],
    listingCount: 0,
    companies: 0,
    jobs: 0,
    pending: 0,
    done: 0,
  });
  const html = renderToStaticMarkup(
    <GlobalDiscovery
      view={view}
      options={options}
      criteria={{
        query: 'Firmware engineer',
        location: 'Los Angeles',
        company: '',
        workMode: 'remote',
        savedOnly: false,
        includeExcluded: false,
      }}
      onOptions={() => {}}
      command={async () => {}}
      busy={false}
    />,
  );
  expect(html).not.toContain('LinkedIn Jobs query / priority keywords');
  expect(html).toContain('Firmware engineer');
  expect(html).toContain('Los Angeles');
  expect(html).toContain('Python or python-jobspy is unavailable');
  expect(html).toContain('discovery-stats');
});
