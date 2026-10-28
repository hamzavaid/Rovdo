/** Cross-package fixture: public retrieval through durable storage, ranking and export. No AI or network. */
import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter } from '@rovdo/job-sources';
import { BUILTIN_RANKINGS, exportJobs } from '@rovdo/career';
import type { SourceConfig } from '@rovdo/shared';
import { sampleCandidate, AS_OF } from '../../../tests/fixtures/ranking-v2';
import { DiscoveryEngine } from './index';
vi.mock('@rovdo/providers', () => {
  throw new Error('No AI in collection or matching');
});
it('quarantines siblings, preserves unknown dates/provenance, deduplicates and survives failed refresh/restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rovdo-pipeline-'));
  const path = join(directory, 'career.sqlite');
  let store = new CareerStore(path);
  let time = Date.parse(AS_OF + 'T12:00:00Z'),
    fail = false;
  const configs: SourceConfig[] = (['greenhouse', 'lever'] as const).map((ats, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    ats,
    company: 'Fixture',
    tenant: 'fixture',
    enabled: true,
    region: 'global',
    intervalMs: 86400000,
    termsReviewedAt: AS_OF + 'T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 3,
  }));
  const engine = () =>
    new DiscoveryEngine(
      store,
      (s) =>
        new AtsAdapter(s, async () => ({
          status: fail ? 503 : 200,
          headers: {},
          body: Buffer.from(
            JSON.stringify(
              s.ats === 'greenhouse'
                ? {
                    jobs: [
                      {
                        id: 1,
                        title: 'Backend Engineer',
                        location: { name: 'Remote' },
                        content: 'Required qualifications: TypeScript',
                        absolute_url: 'https://jobs.lever.co/fixture/shared',
                        first_published: '2026-02-30',
                      },
                      { id: 2, title: null },
                    ],
                  }
                : [
                    {
                      id: 'shared',
                      text: 'Backend Engineer',
                      categories: { location: 'Remote' },
                      descriptionPlain: 'Required qualifications: TypeScript',
                      hostedUrl: 'https://jobs.lever.co/fixture/shared',
                      workplaceType: 'remote',
                    },
                  ],
            ),
          ),
        })),
      {
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        random: () => 0,
      },
    );
  try {
    store.saveProfile(sampleCandidate());
    configs.forEach((s) => store.saveSource(s));
    await engine().pollAll();
    expect(store.jobCount()).toBe(1);
    const job = store.jobs()[0]!;
    expect(job.postedAt).toBeNull();
    expect(job.provenance).toHaveLength(2);
    expect(store.sources().find((s) => s.config.ats === 'greenhouse')!.state.rejected).toBe(1);
    store.saveJob(job.id, true);
    await store.refreshSearchMetadata();
    const search = {
      query: 'TypeScript',
      company: '',
      workMode: 'all' as const,
      savedOnly: true,
      includeExcluded: false,
    };
    const rows = store.searchFiltered(search);
    expect(rows).toHaveLength(1);
    const page = await store.rankedPageAsync(
      rows,
      store.profile()!,
      BUILTIN_RANKINGS[1]!,
      AS_OF,
      search,
    );
    expect(page.matches[0]!.ranking!.requiredCoverage).toBe(1);
    const exported = JSON.parse(exportJobs(page.matches, 'json').data);
    expect(exported[0]).toMatchObject({
      postedAt: '',
      applicationUrl: job.canonicalUrl,
      qualificationScore: page.matches[0]!.score,
    });
    time += 86400001;
    await engine().pollAll();
    expect(store.jobCount()).toBe(1);
    fail = true;
    time += 86400001;
    await engine().pollAll();
    expect(store.sources().every((s) => s.state.status === 'FAILED_SOURCE' && s.state.error)).toBe(
      true,
    );
    store.close();
    store = new CareerStore(path);
    expect(store.savedIds()).toEqual([job.id]);
    expect(store.jobs()[0]!.provenance).toHaveLength(2);
    expect(store.jobs()[0]!.activeStatus).toBe('open');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
