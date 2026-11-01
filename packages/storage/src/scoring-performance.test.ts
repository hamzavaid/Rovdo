/** Explicit, synthetic SQLite cold/warm workload; no network, provider or personal data. */
import { expect, it } from 'vitest';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CareerStore } from './career';
import { BUILTIN_RANKINGS } from '@rovdo/career';
import { sampleCandidate, sampleJob, AS_OF } from '../../../tests/fixtures/ranking-v2';
it.runIf(process.env.ROVDO_PERFORMANCE === '1')(
  'measures large-profile SQLite ranking, cache reuse and cancellation',
  async () => {
    const store = new CareerStore(':memory:');
    try {
      const source = store.globalSource('performance', 'Fixture', 'https://careers.example');
      const jobs = Array.from({ length: 1000 }, (_, i) => ({
        ...sampleJob('TypeScript required'),
        id: `performance:${i}`,
        title: `Backend Engineer ${i}`,
        canonicalUrl: `https://careers.example/${i}`,
        provenance: [
          {
            sourceId: source.id,
            sourceKey: String(i),
            url: `https://careers.example/${i}`,
            collectedAt: 1,
            rawSha256: 'a'.repeat(64),
            fields: {},
          },
        ],
      }));
      await store.batchAsync(source, jobs, store.sources()[0]!.state, 'fixture', true, 1);
      const profile = sampleCandidate();
      profile.intelligence!.skills.push(
        ...Array.from({ length: 147 }, (_, i) => ({
          id: `extra:${i}`,
          skillId: `custom:extra-${i}`,
          version: null,
          depth: 'declared' as const,
          verified: true,
          evidenceIds: ['assertion'],
        })),
      );
      const search = {
        query: '',
        company: '',
        workMode: 'all' as const,
        savedOnly: false,
        includeExcluded: false,
      };
      const measurements = [];
      for (const cache of ['cold', 'warm']) {
        const delay = monitorEventLoopDelay({ resolution: 1 });
        delay.enable();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const cpu = process.cpuUsage(),
          start = performance.now(),
          heap = process.memoryUsage().heapUsed;
        const page = await store.rankedPageAsync(
          store.iterateFiltered(search),
          profile,
          BUILTIN_RANKINGS[1]!,
          AS_OF,
          search,
          Infinity,
          true,
        );
        delay.disable();
        const used = process.cpuUsage(cpu);
        expect(page.total).toBe(1000);
        measurements.push({
          cache,
          elapsedMs: performance.now() - start,
          maximumEventLoopDelayMs: delay.max / 1e6,
          cpuMs: (used.user + used.system) / 1000,
          heapDeltaBytes: process.memoryUsage().heapUsed - heap,
          rssBytes: process.memoryUsage().rss,
          ...store.cacheStats,
        });
      }
      const controller = new AbortController();
      const changed = {
        ...profile,
        version: profile.version + 1,
        preferences: { ...profile.preferences, roles: ['Different fixture role'] },
      };
      const start = performance.now();
      let requestedAt = start;
      const timer = setTimeout(() => {
        requestedAt = performance.now();
        controller.abort();
      }, 10);
      await expect(
        store.rankedPageAsync(
          store.iterateFiltered(search),
          changed,
          BUILTIN_RANKINGS[1]!,
          AS_OF,
          search,
          Infinity,
          false,
          controller.signal,
        ),
      ).rejects.toThrow('CANCELED');
      clearTimeout(timer);
      const cancellationMs = performance.now() - requestedAt;
      const cancellationRequestDelayMs = requestedAt - start - 10;
      expect(cancellationMs).toBeLessThan(500);
      const duplicateSource = store.globalSource(
        'duplicate-performance',
        'Fixture',
        'https://duplicates.example',
      );
      const duplicates = jobs.map((job, i) => ({
        ...job,
        id: `duplicate:${i}`,
        title: 'Duplicate fixture',
        canonicalUrl: `https://duplicates.example/${i}`,
        provenance: [
          {
            ...job.provenance[0]!,
            sourceId: duplicateSource.id,
            url: `https://duplicates.example/${i}`,
          },
        ],
      }));
      const duplicateStart = performance.now();
      await store.batchAsync(
        duplicateSource,
        duplicates,
        store.sources().find((s) => s.config.id === duplicateSource.id)!.state,
        'duplicates',
        false,
        1,
      );
      const duplicateIngestionMs = performance.now() - duplicateStart;
      expect(store.jobCount()).toBe(2000);
      expect(store.job('duplicate:0').duplicateGroup).not.toBe(null);
      mkdirSync('artifacts', { recursive: true });
      writeFileSync(
        'artifacts/sqlite-performance.json',
        JSON.stringify(
          {
            node: process.version,
            platform: process.platform,
            candidateSkills: profile.intelligence!.skills.length,
            jobs: jobs.length,
            measurements,
            cancellationMs,
            cancellationRequestDelayMs,
            duplicateIngestionMs,
          },
          null,
          2,
        ),
      );
    } finally {
      store.close();
    }
  },
  60000,
);
