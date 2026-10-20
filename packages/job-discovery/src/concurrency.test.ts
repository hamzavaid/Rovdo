import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter } from '@rovdo/job-sources';
import type { SourceConfig } from '@rovdo/shared';
import { DiscoveryEngine } from './index';
it('polls different origins concurrently within a bound and isolates failures', async () => {
  const store = new CareerStore(':memory:');
  let active = 0;
  let maximum = 0;
  const release: (() => void)[] = [];
  for (const [i, ats] of (['greenhouse', 'lever', 'ashby'] as const).entries())
    store.saveSource({
      id: `00000000-0000-4000-8000-00000000000${i + 1}`,
      ats,
      tenant: 'fixture',
      company: 'Fixture',
      enabled: true,
      region: 'global',
      intervalMs: 60000,
      termsReviewedAt: '2026-10-18T00:00:00Z',
      timezone: 'UTC',
      priority: 0,
      missingGracePolls: 2,
    });
  const engine = new DiscoveryEngine(
    store,
    (s: SourceConfig) =>
      new AtsAdapter(s, async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
        return {
          status: s.ats === 'lever' ? 503 : 200,
          headers: {},
          body: Buffer.from('{"jobs":[]}'),
        };
      }),
    { concurrency: 2 },
  );
  try {
    const work = engine.pollAll();
    await new Promise((r) => setTimeout(r, 10));
    expect(active).toBe(2);
    release.splice(0).forEach((r) => r());
    await new Promise((r) => setTimeout(r, 10));
    release.splice(0).forEach((r) => r());
    await work;
    expect(maximum).toBe(2);
    expect(store.sources().filter((s) => s.state.status === 'FAILED_SOURCE')).toHaveLength(1);
  } finally {
    release.splice(0).forEach((r) => r());
    await engine.shutdown();
    store.close();
  }
});
