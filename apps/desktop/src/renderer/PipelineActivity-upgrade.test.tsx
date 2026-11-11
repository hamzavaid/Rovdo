import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoveryViewSchema } from '@rovdo/shared';
import { PipelineActivity } from './JobsCollection';

const at = Date.UTC(2026, 10, 11, 18);
const progress = {
  sequence: 12,
  at,
  employersChecked: 5,
  employersAdded: 2,
  jobsAdded: 7,
  jobsUpdated: 3,
  unchangedChecks: 4,
  lastActivityAt: at,
  waiting: [],
};

function view(overrides: Record<string, unknown> = {}) {
  return DiscoveryViewSchema.parse({
    events: [],
    plan: [],
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'running',
      lane: 'jobs',
      createdAt: at,
      updatedAt: at,
      profileVersion: null,
      queries: [],
      options: { sourceIds: ['lever'], overrides: {} },
      reason: null,
    },
    runs: [],
    registry: [],
    coverage: [
      {
        sourceId: 'lever',
        status: 'ready',
        requests: 8,
        records: 10,
        rejected: 0,
        error: null,
        updatedAt: at,
      },
    ],
    listings: [],
    listingCount: 0,
    companies: 500,
    jobs: 10,
    pending: 2,
    done: 8,
    filtered: 0,
    progress,
    ...overrides,
  });
}

function render(input: ReturnType<typeof view>, lane: 'jobs' | 'companies' = 'jobs') {
  return renderToStaticMarkup(
    <PipelineActivity view={input} lane={lane} command={async () => {}} busy={false} />,
  );
}

it('shows checked employers and unchanged checks as progress independently of source counts', () => {
  const html = render(view());

  for (const label of [
    '5 employers checked',
    '2 employers added',
    '7 new jobs',
    '3 updated jobs',
    '4 unchanged checks',
    '1 sources checked',
  ])
    expect(html).toContain(label);
  expect(html).toMatch(/last activity/i);
  expect(html).toContain(new Date(at).toLocaleString());
  expect(html).not.toContain('500 supported');
  expect(html).not.toContain('500 verified');
  expect(html).not.toContain('progressbar');
  expect(html).not.toMatch(/\d+%/);
});

it('shows a stalled archive timeout and retry time while preserving healthy collection progress', () => {
  const html = render(
    view({
      progress: {
        ...progress,
        waiting: [{ sourceId: 'wayback', reason: 'request-timeout', retryAt: at + 60_000 }],
      },
    }),
    'companies',
  );

  expect(html).toContain('Company discovery in progress');
  expect(html).toMatch(/timed out/i);
  expect(html).toMatch(/retry/i);
  expect(html).toContain(new Date(at + 60_000).toLocaleString());
  expect(html).toContain('5 employers checked');
  expect(html).not.toContain('Ready to search');
  expect(html).not.toContain('request-timeout');
});

it('explains waiting reasons without leaking enum codes or inventing a retry date', () => {
  for (const [reason, explanation] of [
    ['rate-limited', /rate limit/i],
    ['retry-scheduled', /retry scheduled/i],
    ['paused', /paused/i],
    ['offline', /offline/i],
    ['budget-exhausted', /budget|limit reached/i],
  ] as const) {
    const html = render(
      view({ progress: { ...progress, waiting: [{ sourceId: 'lever', reason, retryAt: null }] } }),
    );

    expect(html).toMatch(explanation);
    if (reason.includes('-')) expect(html).not.toContain(reason);
    expect(html).not.toContain('1970');
  }
});

it('keeps technical stages in closed details and omits request payloads from normal progress', () => {
  const html = render(
    view({
      events: [
        {
          sequence: 1,
          runId: '00000000-0000-4000-8000-000000000001',
          at,
          stage: 'acquire',
          status: 'running',
          count: 10,
          reason: null,
        },
      ],
    }),
  );
  const stagesAt = html.indexOf('pipeline-segments');
  const detailsAt = html.lastIndexOf('<details', stagesAt);
  const detailsEnd = html.indexOf('</details>', detailsAt);

  expect(stagesAt).toBeGreaterThan(-1);
  expect(detailsAt).toBeGreaterThan(-1);
  expect(detailsEnd).toBeGreaterThan(stagesAt);
  expect(html.slice(detailsAt, html.indexOf('>', detailsAt))).not.toMatch(/\bopen\b/);
  expect(html).not.toContain('Request Log');
  expect(html).not.toContain('request-record');
});

it('distinguishes an unused collection from a running collection that has no successful checks', () => {
  const html = render(
    view({
      run: null,
      coverage: [],
      jobs: 0,
      companies: 0,
      done: 0,
      pending: 0,
      progress: {
        ...progress,
        sequence: 0,
        employersChecked: 0,
        employersAdded: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        unchangedChecks: 0,
        lastActivityAt: null,
      },
    }),
  );

  expect(html).toContain('Ready to search');
  expect(html).toMatch(/no recorded activity|not yet/i);
  expect(html).not.toMatch(/timed out|retry scheduled/i);
  expect(html).not.toContain('>Pause<');
  expect(html).not.toContain('>Stop<');
  expect(html).not.toContain('Example Devices');

  const stalled = render(
    view({
      coverage: [],
      jobs: 0,
      progress: {
        ...progress,
        employersChecked: 0,
        employersAdded: 0,
        jobsAdded: 0,
        jobsUpdated: 0,
        unchangedChecks: 0,
        lastActivityAt: null,
        waiting: [{ sourceId: 'lever', reason: 'request-timeout', retryAt: at + 60_000 }],
      },
    }),
  );
  expect(stalled).toContain('Collection in progress');
  expect(stalled).toMatch(/timed out/i);
  expect(stalled).not.toContain('Ready to search');
});
