import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('registers a Workable source, collects scoped jobs and retains them across restart', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const args = [
    resolve('apps/desktop'),
    `--rovdo-data-dir=${test.info().outputPath('workable-data')}`,
  ];
  let app = await electron.launch({ args, env });
  try {
    await app.evaluate(() => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(process.cwd() + '/fixture.cjs');
      const { EventEmitter } = process.getBuiltinModule('node:events');
      (require('node:dns/promises') as { lookup: unknown }).lookup = async () => [
        { address: '93.184.216.34', family: 4 },
      ];
      (require('node:https') as { request: unknown }).request = (
        url: URL,
        options: { method: string; headers: Record<string, string> },
        callback: (res: unknown) => void,
      ) => {
        if (
          url.origin !== 'https://apply.workable.com' ||
          options.method !== 'GET' ||
          Object.keys(options.headers).some((h) => /authorization|cookie/i.test(h))
        )
          throw new Error('Unexpected request');
        const body =
          url.pathname === '/robots.txt'
            ? 'User-agent: *\nDisallow:'
            : JSON.stringify({
                name: 'Fixture Museum',
                jobs: [
                  {
                    shortcode: 'US1',
                    title: 'Fixture Workable Conservator',
                    country: 'United States',
                    description: '<p>Conservation experience required.</p>',
                    url: 'https://apply.workable.com/j/US1',
                  },
                  {
                    shortcode: 'DE1',
                    title: 'Excluded German Conservator',
                    country: 'Germany',
                    description: '<p>Conservation experience required.</p>',
                    url: 'https://apply.workable.com/j/DE1',
                  },
                ],
              });
        return Object.assign(new EventEmitter(), {
          end() {
            setImmediate(() => {
              const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
              callback(response);
              response.emit('data', Buffer.from(body));
              response.emit('end');
            });
          },
          destroy() {},
        });
      };
    });
    let page = await app.firstWindow();
    await page.evaluate(() =>
      window.rovdo!.careerCommand({
        op: 'saveCollectionScope',
        scope: { version: 1, countries: ['US'], origin: 'user' },
      }),
    );
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Companies', exact: true }).click();
    await page.getByText('Register a saved ATS tenant manually', { exact: true }).click();
    const registration = page
      .locator('details')
      .filter({ has: page.getByText('Register a saved ATS tenant manually', { exact: true }) });
    await registration.getByLabel('ATS').selectOption('workable');
    await page.getByLabel('Employer name', { exact: true }).fill('Fixture Museum');
    await page.getByLabel('Public board / tenant identifier', { exact: true }).fill('fixture');
    await page
      .getByLabel("I reviewed this source's access terms and permit read-only polling")
      .check();
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    const source = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Fixture Museum', exact: true }) });
    await source.getByRole('button', { name: 'Refresh saved company', exact: true }).click();
    await expect(source).toContainText('OK', { timeout: 15000 });
    await page
      .getByRole('navigation', { name: 'Jobs views' })
      .getByRole('button', { name: 'Find Jobs', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Fixture Workable Conservator', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Excluded German Conservator', { exact: true })).toHaveCount(0);
    await app.close();
    app = await electron.launch({ args, env });
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Fixture Workable Conservator', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Companies', exact: true }).click();
    const inventory = page.getByRole('region', { name: 'Verified Source Directory', exact: true });
    await inventory.getByLabel('ATS provider').selectOption('workable');
    await expect(
      inventory.getByRole('heading', { name: 'Fixture Museum workable / fixture', exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
