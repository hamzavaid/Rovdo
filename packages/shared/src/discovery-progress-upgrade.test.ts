/** Planned progress boundary. NOT RUN; an absent export is the expected initial RED. */
import { expect, it } from 'vitest';
import { DiscoveryProgressSchema } from './discovery';

const idle = () => ({
  sequence: 0,
  at: 0,
  employersChecked: 0,
  employersAdded: 0,
  jobsAdded: 0,
  jobsUpdated: 0,
  unchangedChecks: 0,
  lastActivityAt: null,
  waiting: [],
});

it('accepts initial idle progress without inventing a completion percentage', () => {
  expect(DiscoveryProgressSchema.parse(idle())).toEqual(idle());
});

it('preserves independent cumulative counts including unchanged successful checks', () => {
  const progress = {
    ...idle(),
    sequence: 12,
    at: 9000,
    employersChecked: 7,
    employersAdded: 2,
    jobsAdded: 31,
    jobsUpdated: 8,
    unchangedChecks: 4,
    lastActivityAt: 8990,
  };
  expect(DiscoveryProgressSchema.parse(progress)).toEqual(progress);
});

it('accepts every enumerated waiting reason with explicit nullable retry timing', () => {
  const progress = {
    ...idle(),
    waiting: [
      { sourceId: 'wayback', reason: 'request-timeout', retryAt: 60000 },
      { sourceId: 'common-crawl', reason: 'retry-scheduled', retryAt: 90000 },
      { sourceId: 'lever', reason: 'rate-limited', retryAt: 120000 },
      { sourceId: 'remotive', reason: 'paused', retryAt: null },
      { sourceId: 'himalayas', reason: 'offline', retryAt: null },
      { sourceId: 'live-validation', reason: 'budget-exhausted', retryAt: 86400000 },
    ],
  };
  expect(DiscoveryProgressSchema.parse(progress)).toEqual(progress);
});

it('rejects negative fractional and nonfinite sequence counts and timestamps', () => {
  const numericFields = [
    'sequence',
    'at',
    'employersChecked',
    'employersAdded',
    'jobsAdded',
    'jobsUpdated',
    'unchangedChecks',
    'lastActivityAt',
  ];
  for (const field of numericFields)
    for (const invalid of [-1, 0.5, Infinity, NaN])
      expect(DiscoveryProgressSchema.safeParse({ ...idle(), [field]: invalid }).success).toBe(
        false,
      );
});

it('rejects unstructured waiting reasons and invalid retry timestamps', () => {
  for (const waiting of [
    [{ sourceId: 'wayback', reason: 'private network exception text', retryAt: null }],
    [{ sourceId: 'wayback', reason: 'request-timeout', retryAt: -1 }],
    [{ sourceId: 'wayback', reason: 'request-timeout', retryAt: 1.5 }],
    [{ sourceId: 'wayback', reason: 'request-timeout', retryAt: Infinity }],
    [{ sourceId: 'wayback', reason: 'request-timeout' }],
    [{ sourceId: 42, reason: 'offline', retryAt: null }],
  ])
    expect(DiscoveryProgressSchema.safeParse({ ...idle(), waiting }).success).toBe(false);
});

it('rejects fabricated completion and unrestricted top-level error payloads', () => {
  for (const additional of [{ percentComplete: 90 }, { error: 'synthetic private detail' }])
    expect(DiscoveryProgressSchema.safeParse({ ...idle(), ...additional }).success).toBe(false);
});

it('rejects extra nested error and URL payloads rather than silently stripping them', () => {
  for (const additional of [
    { error: 'synthetic private detail' },
    { url: 'https://synthetic.example' },
  ])
    expect(
      DiscoveryProgressSchema.safeParse({
        ...idle(),
        waiting: [{ sourceId: 'wayback', reason: 'offline', retryAt: null, ...additional }],
      }).success,
    ).toBe(false);
});

it('requires all outcome counters and explicit idle activity state', () => {
  for (const field of Object.keys(idle())) {
    const incomplete: Record<string, unknown> = { ...idle() };
    delete incomplete[field];
    expect(DiscoveryProgressSchema.safeParse(incomplete).success).toBe(false);
  }
});
