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
  for (let i = 0; i < 32; i++) {
    const feed = { ats: 'lever', tenant: `directory-${i}`, region: 'global' };
    store.global.rememberCompany(
      feed,
      `Verified Company ${String(i).padStart(2, '0')}`,
      `https://jobs.lever.co/directory-${i}`,
      1,
    );
    store.global.validateCompany(feed, 2);
  }
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
    await page.getByLabel('Location', { exact: true }).fill('Remote');
    await page.getByRole('button', { name: 'Save search preset', exact: true }).click();
    await page.getByLabel('Preset name').fill('Collision preset');
    // Simulate a concurrent save after this editor loaded its list of names.
    await page.evaluate(async () => {
      const result = await window.rovdo!.careerCommand({
        op: 'saveSearch',
        name: 'Collision preset',
        search: {
          query: '',
          company: '',
          workMode: 'all',
          savedOnly: false,
          includeExcluded: false,
        },
      });
      if (!result.ok) throw new Error('Fixture search could not be saved');
    });
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await expect(page.getByLabel('Preset name')).toHaveValue('Collision preset');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Location', { exact: true }).fill('');
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
    const editor = page.locator('.ranking-editor fieldset');
    expect(await editor.evaluate((e) => getComputedStyle(e).display)).toBe('grid');
    await expect(page.locator('.weight-control')).toHaveCount(8);
    const preview = page.getByRole('region', { name: 'Ranking comparison preview' });
    await expect(preview).toBeVisible();
    await expect(preview.locator('.ranking-preview-scores > div')).toHaveCount(2);
    expect(await preview.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Clone selected ranking', exact: true }).click();
    await expect(page.getByLabel('Ranking name', { exact: true })).toHaveValue(/_clone/);
    await page.getByRole('checkbox', { name: 'Auto-balance weights', exact: true }).check();
    await page.getByRole('spinbutton', { name: 'skills weight', exact: true }).fill('45');
    await expect(page.locator('.weight-heading output')).toHaveText('Total weight: 100 / 100');
    await page.getByRole('button', { name: 'Save ranking configuration', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'skills weight', exact: true })).toHaveValue(
      '45',
    );
    const slider = await page
      .getByRole('slider', { name: 'skills weight slider', exact: true })
      .boundingBox();
    const numeric = await page
      .getByRole('spinbutton', { name: 'skills weight', exact: true })
      .boundingBox();
    expect(slider!.x + slider!.width).toBeLessThanOrEqual(numeric!.x);
    await expect(preview.locator('.ranking-preview-scores strong').first()).toHaveText(
      /^\d+(\.\d+)? \/ 100$/,
    );
    await page.screenshot({ path: test.info().outputPath('ranking-compact.png'), fullPage: true });
    await page.setViewportSize({ width: 900, height: 800 });
    expect(await editor.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await preview.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Import / Export JSON', exact: true }).click();
    await expect(page.getByLabel('Ranking configuration JSON')).toHaveValue(/technical-v2/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Before / After preview' })).toBeVisible();
    await nav.getByRole('button', { name: 'Companies', exact: true }).click();
    const inventory = page.getByRole('region', { name: 'Verified Source Directory' });
    await expect(inventory.locator('.company-directory-card')).toHaveCount(25);
    await inventory.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(inventory.locator('.company-directory-card')).toHaveCount(7);
    await expect(
      page.getByRole('heading', { name: 'Saved employer directory', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Advanced Source Management', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Refresh saved company', exact: true }),
    ).toBeVisible();
    const headerActions = page.locator('.company-header-actions');
    const verifyBounds = await headerActions
      .getByRole('button', { name: '+ Verify company URL', exact: true })
      .boundingBox();
    const logBounds = await headerActions
      .getByRole('button', { name: 'Request Log', exact: true })
      .boundingBox();
    expect(logBounds!.y).toBeGreaterThan(verifyBounds!.y + verifyBounds!.height);
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
    expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath('filters-compact-dark.png') });
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
    expect(persisted.savedSearches()).toHaveLength(2);
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
