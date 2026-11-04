import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { sampleCandidate, sampleJob } from '../fixtures/ranking-v2';
test('filters and pages cached jobs, saves searches, tracks feedback and compares configurations', async () => {
  const dir = test.info().outputPath('search-data');
  await mkdir(dir, { recursive: true });
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  const src = {
    id: '00000000-0000-4000-8000-000000000001',
    ats: 'greenhouse' as const,
    tenant: 'fixture',
    company: 'Fixture',
    enabled: false,
    region: 'global' as const,
    intervalMs: 86400000,
    termsReviewedAt: '2026-10-18T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 3,
  };
  store.saveSource(src);
  store.saveProfile(sampleCandidate());
  store.setDefaultRanking('builtin:technical-balanced');
  store.batch(
    src,
    Array.from({ length: 55 }, (_, i) => ({
      ...sampleJob(),
      id: `fixture:${i}`,
      title: `Backend Engineer ${i}`,
      canonicalUrl: `https://jobs.example.com/${i}`,
      provenance: [
        {
          sourceId: src.id,
          sourceKey: `fixture:${i}`,
          url: `https://jobs.example.com/${i}`,
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    })),
    store.sources()[0]!.state,
    'one',
    true,
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
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Jobs views' });
    await expect(nav.getByRole('button')).toHaveCount(5);
    await expect(page.locator('.job-card')).toHaveCount(10);
    await page.getByRole('button', { name: /^All Filters/ }).click();
    await page.getByLabel('Company name', { exact: true }).fill('No such employer');
    await expect(page.locator('.job-card')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^All Filters/ })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'No matching jobs' })).toBeVisible();
    await page.getByRole('button', { name: /^All Filters/ }).click();
    await page.getByLabel('Company name', { exact: true }).fill('');
    await page.getByText('More criteria', { exact: true }).click();
    await page.getByLabel('Technical role family').selectOption('software');
    await page.getByRole('button', { name: /^Show \d+ results/ }).click();
    await expect(page.locator('.job-card')).toHaveCount(10);
    expect(
      await page
        .locator('.job-card')
        .first()
        .evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThan(275);
    await nav.getByRole('button', { name: 'Scope & Collection', exact: true }).click();
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await nav.getByRole('button', { name: 'Find Jobs', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(10);
    await page.getByRole('button', { name: 'Save opportunity', exact: true }).first().click();
    await nav.getByRole('button', { name: 'Saved Jobs (1)', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Discovery progress', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel('Search Jobs', { exact: true })).toHaveCount(0);
    await page.locator('.job-details > summary').first().click();
    await page.getByLabel('Private notes').fill('Follow up after reviewing requirements');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await page.getByLabel('Application status').selectOption('interviewing');
    await nav.getByRole('button', { name: 'Find Jobs', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(10);
    await page.getByLabel('Results per page').selectOption('50');
    await expect(page.locator('.job-card')).toHaveCount(50);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(5);
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByRole('button', { name: 'Save search preset', exact: true }).click();
    await page.getByLabel('Preset name').fill('My backend search');
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await expect(page.getByRole('option', { name: 'My backend search', exact: true })).toHaveCount(
      1,
    );
    await nav.getByRole('button', { name: 'Scope & Collection', exact: true }).click();
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await nav.getByRole('button', { name: 'Find Jobs', exact: true }).click();
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        (globalThis as typeof globalThis & { openedJob?: string }).openedJob = url;
      };
    });
    await page.locator('.job-title-link').first().click();
    expect(
      await app.evaluate(
        () => (globalThis as typeof globalThis & { openedJob?: string }).openedJob,
      ),
    ).toMatch(/^https:\/\/jobs.example.com\//);
    await page.getByText('Export current page', { exact: true }).click();
    const bottoms = await page
      .locator('.jobs-export button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(3);
    await nav.getByRole('button', { name: 'Ranking Methods', exact: true }).click();
    await page.getByRole('button', { name: 'Import / Export JSON', exact: true }).click();
    await expect(page.getByLabel('Ranking configuration JSON')).toHaveValue(/technical-v2/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Before / After preview' })).toBeVisible();
    await nav.getByRole('button', { name: 'Find Jobs', exact: true }).click();
    for (const mode of ['light', 'dark'] as const) {
      await page.getByLabel('Appearance', { exact: true }).selectOption(mode);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page
        .locator('.job-card')
        .first()
        .screenshot({ path: test.info().outputPath(`job-card-${mode}.png`) });
    }
    await page.getByRole('button', { name: /^All Filters/ }).click();
    await page.getByText('More criteria', { exact: true }).click();
    await page.getByLabel('Eligibility constraint').selectOption('fail');
    await expect(page.getByLabel('Show excluded', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: /^Show \d+ results/ }).click();
    await expect(
      page.locator('form').getByRole('button', { name: 'Find Jobs', exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('jobs-v5.png') });
  } finally {
    await app.close();
  }
  const persisted = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  try {
    expect(persisted.savedSearches()).toHaveLength(1);
    expect(
      persisted
        .markers()
        .some(
          (m) =>
            m.applied && m.applicationStatus === 'interviewing' && m.notes.includes('Follow up'),
        ),
    ).toBe(true);
  } finally {
    persisted.close();
  }
});
