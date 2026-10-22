/** Real local persistence and dialogs; no Python packages, internet, model calls or external browser launches. */
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { sampleCandidate } from '../fixtures/ranking-v2';

test('persists scraping consent and edits typed project proposals in a cancelable center dialog', async () => {
  const dir = test.info().outputPath('data');
  await mkdir(dir, { recursive: true });
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  store.saveProfile(sampleCandidate());
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
    const enable = page.getByRole('button', { name: 'Enable JobSpy scraping', exact: true });
    await expect(enable).toBeDisabled();
    await page.getByLabel('I understand the risks', { exact: false }).check();
    await enable.click();
    await expect(
      page.getByRole('button', { name: 'Disable JobSpy scraping', exact: true }),
    ).toBeEnabled();
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
    await expect(
      page.getByRole('button', { name: 'Disable JobSpy scraping', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Disable JobSpy scraping', exact: true }).click();
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
    expect(saved.jobSpySettings().enabled).toBe(false);
  } finally {
    saved.close();
  }
});
