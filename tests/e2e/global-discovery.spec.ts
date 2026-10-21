/** Exercises real Electron IPC/storage with a mocked public transport; no network or model calls. */
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('globally discovers an unsaved employer, separates scopes, exports and persists a paused search', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const args = [
    resolve('apps/desktop'),
    `--rovdo-data-dir=${test.info().outputPath('global-data')}`,
  ];
  let app = await electron.launch({ args, env });
  try {
    await app.evaluate(async () => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(process.cwd() + '/fixture.cjs');
      const { EventEmitter } = process.getBuiltinModule('node:events');
      (require('node:dns/promises') as { lookup: unknown }).lookup = async () => [
        { address: '93.184.216.34', family: 4 },
      ];
      (require('node:https') as { request: unknown }).request = (
        url: URL,
        _options: unknown,
        callback: (res: unknown) => void,
      ) => {
        let data: unknown;
        let statusCode = 200;
        if (url.hostname === 'index.example') {
          if (url.searchParams.get('pageno') === '2') {
            data = {};
            statusCode = 429;
          } else
            data = {
              results: [
                {
                  title: 'Outside Directory Engineer',
                  url: 'https://jobs.lever.co/unsaved-fixture/123',
                },
              ],
            };
        } else if (url.pathname === '/robots.txt') data = 'User-agent: *\nAllow: /';
        else if (url.hostname === 'jobs.lever.co')
          data =
            '<script type="application/ld+json">{"@type":"JobPosting","title":"Outside Directory Engineer","description":"TypeScript required","url":"https://jobs.lever.co/unsaved-fixture/123","hiringOrganization":{"name":"Unsaved Fixture"}}</script>';
        else if (url.hostname === 'api.lever.co')
          data = [
            {
              id: '123',
              text: 'Outside Directory Engineer',
              hostedUrl: 'https://jobs.lever.co/unsaved-fixture/123',
              descriptionPlain: 'TypeScript required',
              categories: { location: 'Remote' },
            },
          ];
        else throw new Error('Unexpected fixture destination');
        return Object.assign(new EventEmitter(), {
          end() {
            setTimeout(() => {
              const res = Object.assign(new EventEmitter(), {
                statusCode,
                headers: statusCode === 429 ? { 'retry-after': '600' } : {},
              });
              callback(res);
              res.emit('data', Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
              res.emit('end');
            }, 20);
          },
          destroy() {},
        });
      };
    });
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await expect(page.getByLabel('Search scope', { exact: true })).toHaveValue('global');
    await expect(
      page.getByRole('option', { name: 'Search All Saved Companies', exact: true }),
    ).toHaveCount(1);
    await page.getByText('Sources, queries and collection settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Clear source selection', exact: true }).click();
    await page.getByLabel('Find discovery sources', { exact: true }).fill('Open web index');
    await page.getByRole('checkbox', { name: 'Open web index', exact: true }).check();
    await page.getByLabel('Find discovery sources', { exact: true }).fill('Lever');
    await page.getByRole('checkbox', { name: 'Lever', exact: true }).check();
    await page
      .getByLabel('Permitted SearXNG JSON endpoint (optional)', { exact: true })
      .fill('https://index.example/search');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Outside Directory Engineer', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole('region', { name: 'Discovery progress', exact: true }),
    ).toContainText('1 unique jobs collected');
    await page.getByRole('button', { name: 'Pause discovery', exact: true }).click();
    await expect(page.getByText('Collection paused', { exact: true })).toBeVisible();
    await page.getByLabel('Search scope', { exact: true }).selectOption('saved-companies');
    await page.getByRole('button', { name: 'Apply filters to cached jobs', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(0);
    await page.getByLabel('Search scope', { exact: true }).selectOption('global');
    await page.getByRole('button', { name: 'Apply filters to cached jobs', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(1);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, test.info().outputPath('export.csv'));
    await page.getByRole('button', { name: 'Export page CSV', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'File saved for this page' }),
    ).toBeVisible();
    const settings = await page.evaluate(() => window.rovdo!.getSettings());
    expect(settings.ok && settings.settings.profiles.length).toBe(0);
    await page.screenshot({ path: test.info().outputPath('global-jobs.png') });
    await app.close();
    app = await electron.launch({ args, env });
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await expect(page.getByText('Collection paused', { exact: true })).toBeVisible();
    await expect(page.locator('.job-card')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
