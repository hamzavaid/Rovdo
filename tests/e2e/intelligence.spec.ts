import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';

test('reviews imported qualifications and manages persisted custom ranking profiles without AI', async () => {
  const dir = test.info().outputPath('intelligence-data');
  await mkdir(dir, { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const desktop = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`],
    env,
  });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Imports', exact: true }).click();
    await page.getByText('Paste a profile', { exact: true }).click();
    await page
      .getByLabel('Pasted profile content')
      .fill(
        'Skills\nTypeScript, Node.js\nEducation\nBachelor in Computer Science | Fixture University | completed 2021\nCitizenship: US',
      );
    await page.getByRole('button', { name: 'Preview pasted profile' }).click();
    await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
    await page.getByRole('button', { name: /Review typescript imported skill/ }).click();
    await page.getByLabel('Review skill 1 skillId', { exact: true }).fill('typescript');
    await page.getByRole('button', { name: 'Close qualification editor', exact: true }).click();
    await page.getByRole('button', { name: 'Select skills and projects' }).click();
    await page.getByRole('button', { name: 'Education (1)', exact: true }).click();
    await expect(page.getByLabel('Verify education 1', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /Review .* imported education/ }).click();
    await page
      .getByLabel('I individually reviewed this qualification and its source evidence')
      .check();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByLabel('Verify education 1', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Continue to confirmation' }).click();
    await expect(page.getByRole('button', { name: 'Verify selected and merge' })).toBeDisabled();
    await page
      .getByLabel('I reviewed the selected qualifications and their source evidence')
      .check();
    await page.getByRole('button', { name: 'Verify selected and merge' }).click();
    await expect(page.getByText('Profile version 1', { exact: true })).toBeVisible();
    await page.getByText('Verified structured qualifications', { exact: true }).click();
    await expect(page.getByText('2 verified skills', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Ranking & matching', exact: true }).click();
    await page.getByLabel('Ranking preset').selectOption('builtin:technical-balanced');
    await page.getByText('Manage ranking profiles', { exact: true }).click();
    await page.getByText('Configure selected ranking', { exact: true }).click();
    await expect(page.getByLabel('Ranking name', { exact: true })).toBeDisabled();
    await page.getByText('Manage ranking profiles', { exact: true }).click();
    const clone = page.getByRole('button', { name: 'Clone selected ranking', exact: true });
    await expect(clone).toBeVisible();
    expect(await clone.evaluate((e) => e.previousElementSibling?.textContent)).toBe(
      'Use as default ranking',
    );
    await clone.click();
    await expect(page.getByLabel('Ranking preset').locator('option:checked')).toHaveText(
      'Technical Balanced v2_clone',
    );
    await expect(page.getByLabel('Ranking name', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Ranking name', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Ranking name', { exact: true })).toHaveValue(
      'Technical Balanced v2_clone',
    );
    await expect(page.getByLabel('confidence threshold', { exact: true })).toHaveValue('75');
    await page.getByLabel('confidence threshold', { exact: true }).fill('80');
    await page.getByLabel('Ranking name', { exact: true }).fill('My conservative backend');
    const skills = Number(await page.getByLabel('skills weight', { exact: true }).inputValue());
    const experience = Number(
      await page.getByLabel('experience weight', { exact: true }).inputValue(),
    );
    await page.getByLabel('experience weight', { exact: true }).fill(String(experience - 5));
    await page.getByRole('button', { name: 'Save ranking configuration' }).click();
    await expect(page.getByRole('alert')).toContainText('Weights must total 100');
    await page.getByLabel('skills weight slider', { exact: true }).focus();
    await page.keyboard.press('End');
    await expect(page.getByLabel('skills weight', { exact: true })).toHaveValue(String(skills + 5));
    await expect(page.getByText('Total weight: 100 / 100', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save ranking configuration' }).click();
    await expect(page.getByLabel('Ranking name', { exact: true })).toHaveValue(
      'My conservative backend',
    );
    await page.getByRole('button', { name: 'Use as default ranking' }).click();
    await expect(page.getByText('Default: My conservative backend', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('ranking-controls.png'), fullPage: true });
    await page.getByRole('button', { name: 'Delete custom ranking' }).click();
    await expect(page.getByLabel('Ranking preset')).toHaveValue('builtin:legacy-v1');
    const providers = await page.evaluate(() => window.rovdo!.getSettings());
    expect(providers.ok && providers.settings.profiles.length).toBe(0);
  } finally {
    await desktop.close();
  }
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  try {
    expect(store.profile()!.intelligence!.skills.every((s) => s.verified)).toBe(true);
    expect(store.profile()!.facts.every((f) => !f.verified)).toBe(true);
    expect(store.rankings()).toHaveLength(5);
  } finally {
    store.close();
  }
});
