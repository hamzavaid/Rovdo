/** NOT RUN. Controlled collection load, not a measured performance claim.
 * The p95 100ms / maximum long-task 200ms budgets are provisional engineering assumptions.
 */
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { sampleCandidate, sampleJob } from '../fixtures/ranking-v2';

test('keeps cached results, input, navigation, scrolling and cancellation responsive during real collection', async () => {
  const dir = test.info().outputPath('discovery-upgrade-data');
  await mkdir(dir, { recursive: true });
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  store.saveCollectionScope({ version: 1, countries: ['US'], origin: 'user' });
  const source = store.globalSource(
    'upgrade-cache',
    'Synthetic Cached Employer',
    'https://synthetic.example',
  );
  const profile = sampleCandidate();
  profile.preferences.locations = ['United States'];
  store.saveProfile(profile);
  store.setting('automatic-company-discovery', 'false');
  store.batch(
    source,
    Array.from({ length: 240 }, (_, i) => ({
      ...sampleJob(),
      id: `upgrade-cache-${i}`,
      title: `Synthetic Cached Engineer ${i}`,
      canonicalUrl: `https://synthetic.example/cached/${i}`,
      provenance: [
        {
          sourceId: source.id,
          sourceKey: String(i),
          url: `https://synthetic.example/cached/${i}`,
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    })),
    store.sources()[0]!.state,
    'synthetic-cache',
    false,
    Date.now(),
  );
  store.close();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`],
    env,
  });
  try {
    // Existing E2E convention: patch only this test process's HTTPS transport. Feed bytes
    // still pass through real network bounds, parsers, durable queue, SQLite and IPC.
    await app.evaluate(() => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(process.cwd() + '/fixture.cjs');
      const { EventEmitter } = process.getBuiltinModule('node:events');
      const fixture = {
        started: [] as string[],
        aborted: 0,
        released: false,
        release: undefined as (() => void) | undefined,
      };
      (
        globalThis as typeof globalThis & { discoveryUpgradeFixture: typeof fixture }
      ).discoveryUpgradeFixture = fixture;
      (require('node:dns/promises') as { lookup: unknown }).lookup = async () => [
        { address: '93.184.216.34', family: 4 },
      ];
      (require('node:https') as { request: unknown }).request = (
        url: URL,
        options: { signal: AbortSignal },
        callback: (
          response: InstanceType<typeof EventEmitter> & { statusCode: number; headers: object },
        ) => void,
      ) => {
        fixture.started.push(url.hostname);
        if (!['remotive.com', 'himalayas.app'].includes(url.hostname))
          throw new Error('Unexpected synthetic transport destination');
        const request = Object.assign(new EventEmitter(), {
          end() {
            if (url.hostname === 'remotive.com')
              fixture.release = () => {
                if (options.signal.aborted || fixture.released) return;
                fixture.released = true;
                const response = Object.assign(new EventEmitter(), {
                  statusCode: 200,
                  headers: {},
                });
                callback(response);
                response.emit(
                  'data',
                  Buffer.from(
                    JSON.stringify({
                      jobs: Array.from({ length: 1200 }, (_, i) => ({
                        id: i,
                        title: `Backend Engineer Newly Collected ${i}`,
                        company_name: `Synthetic Employer ${i % 80}`,
                        url: `https://synthetic.example/fresh/${i}`,
                        description:
                          'Required Qualifications\nTypeScript and Node.js required\n4 years of backend experience\nBachelor degree required\nPreferred Qualifications\nPostgreSQL preferred',
                        candidate_required_location: 'Remote - United States',
                      })),
                    }),
                  ),
                );
                response.emit('end');
              };
          },
          destroy(error?: Error) {
            request.emit('error', error ?? new Error('Synthetic request destroyed'));
          },
        });
        const abort = () => {
          fixture.aborted++;
          request.destroy(new Error('Synthetic request aborted'));
        };
        options.signal.addEventListener('abort', abort, { once: true });
        return request;
      };
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole('heading', { name: 'Workspace overview', exact: true }),
    ).toBeVisible();
    const cachedStart = performance.now();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await expect(page.locator('.job-card').first()).toBeVisible({ timeout: 1000 });
    expect(performance.now() - cachedStart).toBeLessThanOrEqual(1000);

    await page.evaluate(() => {
      const samples: number[] = [];
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: 'longtask', buffered: false });
      const record = (event: Event) =>
        requestAnimationFrame(() => {
          samples.push(performance.now() - event.timeStamp);
        });
      for (const name of ['keydown', 'input', 'pointerdown', 'wheel'])
        document.addEventListener(name, record, { capture: true, passive: true });
      (
        window as typeof window & { upgradeLatency: { samples: number[]; longTasks: number[] } }
      ).upgradeLatency = {
        samples,
        longTasks,
      };
    });
    await app.evaluate(() => {
      const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks');
      const delay = monitorEventLoopDelay({ resolution: 10 });
      delay.enable();
      (
        globalThis as typeof globalThis & {
          discoveryUpgradeDelay: ReturnType<typeof import('node:perf_hooks').monitorEventLoopDelay>;
        }
      ).discoveryUpgradeDelay = delay;
    });
    const started = await page.evaluate(() =>
      window.rovdo!.careerCommand({
        op: 'startDiscovery',
        consent: true,
        options: { sourceIds: ['remotive', 'himalayas'], overrides: {} },
      }),
    );
    expect(started.ok).toBe(true);
    const runId = started.ok ? started.view.discovery!.run!.id : '';
    await expect
      .poll(() =>
        app.evaluate(() => {
          const fixture = (
            globalThis as typeof globalThis & {
              discoveryUpgradeFixture: { started: string[]; release?: () => void };
            }
          ).discoveryUpgradeFixture;
          return (
            fixture.started.includes('remotive.com') && fixture.started.includes('himalayas.app')
          );
        }),
      )
      .toBe(true);
    const freshStart = performance.now();
    await Promise.all([
      app.evaluate(() => {
        (
          globalThis as typeof globalThis & { discoveryUpgradeFixture: { release: () => void } }
        ).discoveryUpgradeFixture.release();
      }),
      page.getByLabel('Search within results', { exact: true }).pressSequentially('Synthetic'),
    ]);
    await expect(page.getByLabel('Search within results', { exact: true })).toHaveValue(
      'Synthetic',
    );
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() =>
            window.rovdo!.careerCommand({
              op: 'view',
              summary: true,
              search: {
                query: '',
                company: '',
                workMode: 'all',
                savedOnly: false,
                includeExcluded: false,
              },
            }),
          );
          return result.ok ? result.view.totalJobs : 0;
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(240);
    expect(performance.now() - freshStart).toBeLessThanOrEqual(15000);
    const progressStart = performance.now();
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() =>
            window.rovdo!.careerCommand({
              op: 'view',
              summary: true,
              search: {
                query: '',
                company: '',
                workMode: 'all',
                savedOnly: false,
                includeExcluded: false,
              },
            }),
          );
          if (!result.ok) return 0;
          const discovery = result.view.discovery as typeof result.view.discovery & {
            progress?: { jobsAdded: number };
          };
          return discovery?.progress?.jobsAdded ?? 0;
        },
        { timeout: 2000 },
      )
      .toBeGreaterThan(0);
    await expect(
      page.getByRole('region', { name: 'Discovery progress', exact: true }),
    ).toContainText(/\d+ new jobs/i, { timeout: 2000 });
    expect(performance.now() - progressStart).toBeLessThanOrEqual(2000);
    await page.getByLabel('Search within results', { exact: true }).fill('');
    await page.getByLabel('Results per page').selectOption('50');
    await page.mouse.move(600, 500);
    await page.mouse.wheel(0, 600);
    const nav = page.getByRole('navigation', { name: 'Jobs views' });
    await nav.getByRole('button', { name: 'Scope & Collection', exact: true }).click();
    await nav.getByRole('button', { name: 'Find Jobs', exact: true }).click();
    await page.getByLabel('Search within results', { exact: true }).fill('Newly Collected 0');
    await expect(
      page.getByRole('heading', { name: 'Backend Engineer Newly Collected 0', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect(performance.now() - freshStart).toBeLessThanOrEqual(15000);
    const collecting = await page.evaluate(() =>
      window.rovdo!.careerCommand({
        op: 'view',
        summary: true,
        search: {
          query: '',
          company: '',
          workMode: 'all',
          savedOnly: false,
          includeExcluded: false,
        },
      }),
    );
    expect(collecting.ok && collecting.view.totalJobs).toBeGreaterThan(240);
    expect(collecting.ok && collecting.view.discovery!.run!.status).toBe('running');
    const cancelStart = performance.now();
    const canceled = await page.evaluate(
      (id) =>
        window.rovdo!.careerCommand({
          op: 'controlDiscovery',
          id,
          action: 'cancel',
        }),
      runId,
    );
    expect(canceled.ok && canceled.view.discovery!.run!.status).toBe('canceled');
    expect(performance.now() - cancelStart).toBeLessThanOrEqual(1000);
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              discoveryUpgradeFixture: { aborted: number };
            }
          ).discoveryUpgradeFixture.aborted,
      ),
    ).toBeGreaterThan(0);
    const latency = await page.evaluate(async () => {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      return (
        window as typeof window & {
          upgradeLatency: { samples: number[]; longTasks: number[] };
        }
      ).upgradeLatency;
    });
    expect(latency.samples.length).toBeGreaterThanOrEqual(10);
    const sorted = [...latency.samples].sort((a, b) => a - b);
    expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThanOrEqual(100);
    expect(Math.max(0, ...latency.longTasks)).toBeLessThanOrEqual(200);
    const mainLoop = await app.evaluate(() => {
      const delay = (
        globalThis as typeof globalThis & {
          discoveryUpgradeDelay: ReturnType<typeof import('node:perf_hooks').monitorEventLoopDelay>;
        }
      ).discoveryUpgradeDelay;
      delay.disable();
      return { count: delay.count, maximumMs: delay.max / 1_000_000 };
    });
    expect(mainLoop.count).toBeGreaterThan(0);
    expect(mainLoop.maximumMs).toBeLessThanOrEqual(200);
    await test.info().attach('controlled-collection-latency', {
      body: JSON.stringify({ renderer: latency, mainLoop }),
      contentType: 'application/json',
    });
  } finally {
    await app.close();
  }
});
