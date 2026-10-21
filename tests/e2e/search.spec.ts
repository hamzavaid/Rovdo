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
    await expect(page.getByLabel('Search scope')).toHaveValue('global');
    await page.getByText('Advanced search filters', { exact: true }).click();
    await page.getByLabel('Company name', { exact: true }).fill('No such employer');
    await page.getByRole('button', { name: 'Apply filters to cached jobs', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No matching jobs' })).toBeVisible();
    await page.getByLabel('Company name', { exact: true }).fill('');
    await page.getByLabel('Technical role family').selectOption('software');
    await page.getByLabel('Minimum qualification score').fill('50');
    await page.getByRole('button', { name: 'Apply filters to cached jobs', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(50);
    await page.getByRole('button', { name: 'Next 50' }).click();
    await expect(page.locator('.job-card')).toHaveCount(5);
    await page.getByRole('button', { name: 'Previous 50' }).click();
    expect(
      await page
        .getByRole('region', { name: 'Saved search management', exact: true })
        .evaluate(
          (e) =>
            !!(
              document.querySelector('.job-list')!.compareDocumentPosition(e) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
    ).toBe(true);
    await page.getByText('Saved searches', { exact: true }).click();
    await page.getByLabel('Saved search name').fill('My backend search');
    await page.getByRole('button', { name: 'Save current search' }).click();
    await expect(page.getByRole('button', { name: 'Load My backend search' })).toBeVisible();
    await page.getByRole('button', { name: 'Mark as applied', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Clear applied marker' })).toBeVisible();
    await page.getByRole('button', { name: 'Relevant', exact: true }).first().click();
    await page.getByRole('button', { name: 'Compare ranking methods' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ranking comparison' })).toBeVisible();
    await page.getByRole('button', { name: 'Ranking & matching', exact: true }).click();
    await page.getByText('Manage ranking profiles', { exact: true }).click();
    await page.getByRole('button', { name: 'Export selected configuration' }).click();
    await expect(page.getByLabel('Ranking configuration JSON')).toHaveValue(/technical-v2/);
    await page.getByRole('button', { name: 'Search & results', exact: true }).click();
    await page
      .locator('.job-search')
      .screenshot({ path: test.info().outputPath('unified-search.png') });
    for (const mode of ['light', 'dark'] as const) {
      await page.getByLabel('Appearance', { exact: true }).selectOption(mode);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page
        .locator('.job-card')
        .first()
        .screenshot({ path: test.info().outputPath(`job-card-${mode}.png`) });
    }
  } finally {
    await app.close();
  }
  const persisted = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  try {
    expect(persisted.savedSearches()).toHaveLength(1);
    expect(persisted.markers().some((m) => m.applied && m.feedback === 'relevant')).toBe(true);
  } finally {
    persisted.close();
  }
});
