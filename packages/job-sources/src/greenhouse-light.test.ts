import { expect, it } from 'vitest';
import { AtsAdapter } from './index';
import { SourceStateSchema } from '@rovdo/shared';
import { randomUUID } from 'node:crypto';
it('enriches a lightweight Greenhouse listing in bounded resumable batches without losing later jobs', async () => {
  const calls: string[] = [];
  const jobs = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1,
    title: `Engineer ${i}`,
    absolute_url: `https://job-boards.greenhouse.io/fixture/jobs/${i + 1}`,
    location: { name: 'Remote' },
  }));
  const adapter = new AtsAdapter(
    {
      id: randomUUID(),
      ats: 'greenhouse',
      tenant: 'fixture',
      region: 'global',
      company: 'Fixture',
      enabled: true,
      intervalMs: 86400000,
      termsReviewedAt: new Date().toISOString(),
      timezone: 'UTC',
      priority: 0,
      missingGracePolls: 3,
    },
    async (url) => {
      calls.push(url);
      const id = Number(new URL(url).pathname.split('/').at(-1));
      return {
        status: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify(id ? { ...jobs[id - 1], content: 'TypeScript required' } : { jobs }),
        ),
      };
    },
    { lightweight: true },
  );
  const state = SourceStateSchema.parse({
    status: 'NEVER_POLLED',
    cursor: null,
    pollId: null,
    etag: null,
    lastModified: null,
    lastPollAt: null,
    lastSuccessAt: null,
    nextPollAt: 0,
    failures: 0,
    responseStatus: null,
    returned: 0,
    parsed: 0,
    rejected: 0,
    duplicates: 0,
    accepted: 0,
    requests: 0,
    durationMs: 0,
    error: null,
    parserVersion: 'ats-v1',
  });
  const first = await adapter.fetchPage(state, new AbortController().signal);
  expect(first.jobs).toHaveLength(8);
  expect(first.nextCursor).toBe('8');
  expect(calls[0]).not.toContain('content=true');
  const last = await adapter.fetchPage(
    { ...state, cursor: first.nextCursor },
    new AbortController().signal,
  );
  expect(last.jobs).toHaveLength(1);
  expect(last.nextCursor).toBeNull();
  expect(new Set([...first.jobs, ...last.jobs].map((j) => j.id)).size).toBe(9);
});
