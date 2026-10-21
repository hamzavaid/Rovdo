/** Real main-process heartbeat while a populated career database prepares uncached scores. */
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { sampleCandidate, sampleJob } from '../fixtures/ranking-v2';
test('boots without ranking and keeps the main event loop responsive during job search', async () => {
  const dir = test.info().outputPath('responsive-data');
  await mkdir(dir, { recursive: true });
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  const source = store.globalSource('responsive', 'Fixture', 'https://careers.example');
  store.saveProfile(sampleCandidate());
  store.batch(
    source,
    Array.from({ length: 240 }, (_, i) => ({
      ...sampleJob(),
      id: 'responsive-' + i,
      canonicalUrl: 'https://careers.example/' + i,
      provenance: [
        {
          sourceId: source.id,
          sourceKey: String(i),
          url: 'https://careers.example/' + i,
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    })),
    store.sources()[0]!.state,
    'fixture',
    false,
    Date.now(),
  );
  store.close();
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole('heading', { name: 'Workspace overview', exact: true }),
    ).toBeVisible();
    const search = {
      query: '',
      company: '',
      workMode: 'all' as const,
      savedOnly: false,
      includeExcluded: false,
    };
    const summary = await page.evaluate(
      (s) => window.rovdo!.careerCommand({ op: 'view', summary: true, search: s }),
      search,
    );
    expect(summary.ok && summary.view.cache?.misses).toBe(0);
    await app.evaluate(() => {
      const g = globalThis as typeof globalThis & {
        rovdoHeartbeat?: number;
        rovdoHeartbeatTimer?: ReturnType<typeof setInterval>;
      };
      g.rovdoHeartbeat = 0;
      g.rovdoHeartbeatTimer = setInterval(() => {
        g.rovdoHeartbeat!++;
      }, 1);
    });
    const result = await page.evaluate(
      (s) => window.rovdo!.careerCommand({ op: 'view', search: s }),
      search,
    );
    expect(result.ok && result.view.matches.length).toBe(50);
    const beats = await app.evaluate(() => {
      const g = globalThis as typeof globalThis & {
        rovdoHeartbeat: number;
        rovdoHeartbeatTimer: ReturnType<typeof setInterval>;
      };
      clearInterval(g.rovdoHeartbeatTimer);
      return g.rovdoHeartbeat;
    });
    expect(beats).toBeGreaterThan(2);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});
