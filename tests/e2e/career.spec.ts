import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { AtsAdapter } from '../../packages/job-sources/src/index';
import { emptyProfile } from '../../packages/career/src/index';

test('edits a verified profile and discovers, filters and saves fixture jobs without AI', async () => {
  const dir = test.info().outputPath('career-data'); await mkdir(dir, { recursive: true });
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  const config = { id: '00000000-0000-4000-8000-000000000001', ats: 'greenhouse' as const, tenant: 'fixture', company: 'Fixture Company', enabled: false, region: 'global' as const, intervalMs: 86400000, termsReviewedAt: '2026-10-16T00:00:00.000Z', timezone: 'America/Los_Angeles', priority: 0, missingGracePolls: 3 };
  store.saveSource(config); store.saveProfile({ ...emptyProfile(), facts: [{ id: 'skill-1', field: 'skill', value: 'TypeScript', verified: true, source: { kind: 'user', reference: 'Fixture assertion', capturedAt: '2026-10-16T00:00:00.000Z' } }] });
  const jobs = new AtsAdapter(config).normalize({ jobs: [{ id: 1, title: 'TypeScript Engineer', content: 'Build TypeScript software. Required skills: TypeScript, Rust.', location: { name: 'Remote' }, absolute_url: 'https://boards.greenhouse.io/fixture/jobs/1' }] });
  store.batch(config, jobs, store.sources()[0]!.state, 'fixture-poll', true, Date.now()); store.close();
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const desktop = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`], env });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Candidate profile' })).toBeVisible();
    await page.getByRole('button', { name: /Edit TypeScript skill/ }).click();
    await expect(page.locator('input[value="TypeScript"]')).toBeVisible();
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await page.getByLabel('Preferred roles').fill('Engineer'); await page.getByRole('button', { name: 'Save candidate profile' }).click();
    await expect(page.getByText('Profile version 2')).toBeVisible();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByLabel('Search jobs').fill('TypeScript'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'TypeScript Engineer' })).toBeVisible(); await expect(page.getByText('Qualification gaps: Rust')).toBeVisible();
    await page.getByRole('button', { name: 'Save opportunity' }).click(); await expect(page.getByRole('button', { name: 'Remove saved opportunity' })).toBeVisible();
    await page.getByRole('button', { name: 'Sources & coverage', exact: true }).click();
    await page.getByText('Source health', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete source Fixture Company' }).click();
    await expect(page.locator('.source-registry article')).toHaveCount(0);
    await page.getByRole('button', { name: 'Search & results', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'TypeScript Engineer' })).toBeVisible();
    const providers = await page.evaluate(async () => (await window.rovdo!.getSettings())); expect(providers.ok && providers.settings.profiles.length).toBe(0);
    await page.screenshot({ path: test.info().outputPath('career-jobs.png') });
  } finally { await desktop.close(); }
  const persisted = new CareerStore(resolve(dir, 'rovdo.sqlite')); try { expect(persisted.sources()).toHaveLength(0); expect(persisted.savedIds()).toHaveLength(1); expect(persisted.profile()!.version).toBe(2); } finally { persisted.close(); }
});
