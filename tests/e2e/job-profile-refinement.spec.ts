/** Real local persistence and dialogs; no Python packages, internet, model calls or external browser launches. */
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { sampleCandidate } from '../fixtures/ranking-v2';

test('retires scraping settings and edits typed project proposals in a cancelable center dialog', async () => {
  const dir = test.info().outputPath('data');
  await mkdir(dir, { recursive: true });
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  store.saveProfile(sampleCandidate());
  const runId = '00000000-0000-4000-8000-000000000001';
  store.global.saveRun({
    id: runId,
    status: 'completed',
    createdAt: 1,
    updatedAt: 1,
    profileVersion: 1,
    queries: ['Firmware'],
    options: { sourceIds: ['linkedin-jobs'], overrides: {} },
    reason: null,
  });
  store.global.note(runId, 'linkedin-jobs', 'blocked', 0, 0, 'JOBSPY_UNAVAILABLE');
  store.close();
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const args = [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`];
  let app = await electron.launch({ args, env });
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Discovery & imports', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your LinkedIn profile', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Automatic public discovery' })).toBeVisible();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: '+ Add a project', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Qualification type' })
      .getByRole('button', { name: 'Project', exact: true })
      .click();
    await page.getByLabel('New project name', { exact: true }).fill('Embedded controller');
    await page
      .getByLabel('New project description', { exact: true })
      .fill('Implemented a deterministic controller with bench test evidence.');
    await page.getByLabel('New project skills', { exact: true }).fill('C++');
    await page.keyboard.press('Enter');
    await page
      .getByLabel('Evidence or assertion reference', { exact: true })
      .fill('My public project documentation and bench test notes.');
    await page.getByRole('button', { name: 'Add project for verification', exact: true }).click();
    await page.getByRole('button', { name: /Embedded controller.*Review/ }).click();
    await page
      .getByLabel('projects 2 description', { exact: true })
      .fill('An edit that will be canceled');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: /Embedded controller.*Review/ }).click();
    await expect(page.getByLabel('projects 2 description', { exact: true })).toHaveValue(
      'Implemented a deterministic controller with bench test evidence.',
    );
    await page.getByLabel('I verify this projects record 2', { exact: true }).check();
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((mode) => {
        document.documentElement.dataset.theme = mode;
      }, theme);
      await page
        .getByRole('dialog')
        .screenshot({ path: test.info().outputPath(`project-editor-${theme}.png`) });
      const bounds = await page.getByRole('dialog').boundingBox();
      expect(bounds!.x).toBeGreaterThan(0);
    }
    await page.getByRole('button', { name: 'Save to draft', exact: true }).click();
    await page.getByRole('button', { name: 'Save candidate profile', exact: true }).click();
    await expect(page.getByText('Profile version 2', { exact: true })).toBeVisible();
    await app.close();
    app = await electron.launch({ args, env });
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Discovery & imports', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Automatic public discovery' })).toBeVisible();
  } finally {
    await app.close();
  }
  const saved = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  try {
    expect(saved.profile()!.intelligence!.projects[1]).toMatchObject({
      name: 'Embedded controller',
      skills: ['cpp'],
      verified: true,
    });
    expect(saved.setting('jobspy-settings')).toBe(null);
  } finally {
    saved.close();
  }
});
