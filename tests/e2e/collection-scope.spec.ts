import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { emptyProfile } from '../../packages/career/src/index';
const launch = async (directory: string) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${directory}`], env });
};
test('asks for collection geography once, persists manual countries, and displays unsupported directory gaps', async () => {
  const directory = test.info().outputPath('scope-data');
  let app = await launch(directory);
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: 'Choose collection countries' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: /Close/ }).click();
    await expect(prompt).not.toBeVisible();
    await app.close();
    app = await launch(directory);
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Find your next job' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose collection countries' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Scope & Collection', exact: true }).click();
    await page.getByLabel('Collection countries').selectOption(['US', 'CA']);
    await page.getByRole('button', { name: 'Save collection countries', exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const r = await window.rovdo!.careerCommand({
            op: 'view',
            summary: true,
            search: {
              query: '',
              company: '',
              workMode: 'all',
              savedOnly: false,
              includeExcluded: false,
            },
          });
          return r.ok ? r.view.collectionScope : null;
        }),
      )
      .toEqual({ scope: { version: 1, countries: ['CA', 'US'], origin: 'user' }, revision: 1 });
    await page.getByRole('button', { name: 'Companies', exact: true }).click();
    await page.getByLabel('Search starter employers').fill('Mayo');
    await expect(page.getByRole('heading', { name: 'Mayo Clinic', exact: true })).toBeVisible();
    const starter = page.getByRole('region', { name: 'Starter employers', exact: true });
    await expect(starter.locator('.company-directory-card')).toHaveCount(1);
    await expect(starter.getByText(/Coverage gap: no automatic collector/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('starter-coverage.png'), fullPage: true });
  } finally {
    await app.close();
  }
  const persisted = new CareerStore(resolve(directory, 'rovdo.sqlite'));
  try {
    expect(persisted.collectionScope()?.scope.countries).toEqual(['CA', 'US']);
  } finally {
    persisted.close();
  }
});
test('infers explicit profile geography without confirmation', async () => {
  const directory = test.info().outputPath('profile-scope-data');
  await mkdir(directory, { recursive: true });
  const store = new CareerStore(resolve(directory, 'rovdo.sqlite'));
  const profile = emptyProfile();
  profile.preferences.locations = ['United States'];
  store.saveProfile(profile);
  store.close();
  const app = await launch(directory);
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Find your next job' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose collection countries' })).toHaveCount(0);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const r = await window.rovdo!.careerCommand({
            op: 'view',
            summary: true,
            search: {
              query: '',
              company: '',
              workMode: 'all',
              savedOnly: false,
              includeExcluded: false,
            },
          });
          return r.ok ? r.view.collectionScope?.scope.origin : null;
        }),
      )
      .toBe('profile');
  } finally {
    await app.close();
  }
});
