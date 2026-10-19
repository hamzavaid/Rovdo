import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { CareerStore } from '../../packages/storage/src/career';
import { AtsAdapter } from '../../packages/job-sources/src/index';
import { sampleCandidate } from '../fixtures/ranking-v2';

test('uses real dashboard data, edits verified qualifications and previews balanced ranking with keyboard-accessible secondary views', async () => {
  const dir = test.info().outputPath('workspace-data'); await mkdir(dir, { recursive: true });
  const source = { id: '00000000-0000-4000-8000-000000000001', ats: 'greenhouse' as const, tenant: 'fixture', company: 'Fixture', enabled: false, region: 'global' as const, intervalMs: 86400000, termsReviewedAt: '2026-10-18T00:00:00Z', timezone: 'UTC', priority: 0, missingGracePolls: 3 };
  const store = new CareerStore(resolve(dir, 'rovdo.sqlite')); store.saveSource(source); store.saveProfile(sampleCandidate());
  const jobs = new AtsAdapter(source).normalize({ jobs: [{ id: 1, title: 'Backend Engineer', content: 'Required: TypeScript and Node.js', location: { name: 'Remote' }, absolute_url: 'https://employer.test/jobs/1' }] });
  store.batch(source, jobs, { ...store.sources()[0]!.state, lastSuccessAt: Date.now(), parsed: 1 }, 'fixture', true, Date.now()); store.saveJob(jobs[0]!.id, true); store.close();
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`], env });
  try {
    const page = await app.firstWindow(); await expect(page.getByTestId('dashboard-indexed')).toHaveText('1');
    await expect(page.locator('.metric-card').filter({ hasText: 'Saved opportunities' }).locator('strong')).toHaveText('1');
    await expect(page.locator('.activity-list')).toContainText('Fixture: successful collection');
    const [activity, time] = await Promise.all([page.locator('.activity-action').first().boundingBox(), page.locator('.activity-list time').first().boundingBox()]);
    expect(time!.x).toBeGreaterThanOrEqual(activity!.x + activity!.width);
    expect(time!.y).toBeLessThan(activity!.y + activity!.height);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('15px');
    await page.screenshot({ path: test.info().outputPath('overview.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review saved opportunities', exact: true }).click();
    await expect(page.getByLabel('Saved only', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.locator('.skill-chip')).toHaveCount(3);
    expect(await page.locator('.skill-chip').first().evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(44);
    await page.getByLabel('Search your skills', { exact: true }).fill('type'); await expect(page.locator('.skill-chip')).toHaveCount(1);
    await page.getByLabel('Search your skills', { exact: true }).fill('');
    await page.screenshot({ path: test.info().outputPath('compact-skills.png'), fullPage: true });
    await page.getByRole('button', { name: /Edit TypeScript skill/ }).click();
    await page.getByText('Edit skills record 1', { exact: true }).click();
    await expect(page.getByLabel('skills 1 skillId', { exact: true })).toHaveValue('typescript');
    await page.getByLabel('skills 1 version', { exact: true }).fill('5');
    await expect(page.getByLabel('I verify this skills record 1', { exact: true })).not.toBeChecked();
    await page.getByLabel('I verify this skills record 1', { exact: true }).check();
    await expect(page.getByLabel('I verify this skills record 1', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Save candidate profile', exact: true }).click();
    await expect(page.getByText('Profile version 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Add', exact: true }).click();
    await page.getByLabel('Fact value', { exact: true }).fill('Rust'); await page.getByLabel('Evidence or assertion reference', { exact: true }).fill('User fixture assertion');
    await page.getByRole('button', { name: 'Add fact for verification', exact: true }).click();
    await page.getByRole('button', { name: /Edit Rust skill/ }).click(); await page.getByLabel('I verify this fact', { exact: true }).check();
    await page.getByRole('button', { name: 'Save candidate profile', exact: true }).click(); await expect(page.getByText('Profile version 3', { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: test.info().outputPath('profile-skills.png'), fullPage: true });
    await page.getByRole('button', { name: 'Experience', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Structured experience', exact: true })).toContainText('Backend Engineer');
    await page.getByRole('button', { name: 'Education', exact: true }).click(); await page.getByText('Edit education record 1', { exact: true }).click();
    await page.getByLabel('education 1 graduation', { exact: true }).fill(''); await page.getByLabel('I verify this education record 1', { exact: true }).check();
    await page.getByRole('button', { name: 'Save candidate profile', exact: true }).click(); await expect(page.getByText('Profile version 4', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Ranking & matching', exact: true }).click();
    await page.getByLabel('Ranking preset').selectOption('builtin:technical-balanced'); await page.getByRole('button', { name: 'Clone selected ranking', exact: true }).click();
    await page.getByLabel('Auto-balance weights', { exact: true }).check(); await page.getByLabel('skills weight', { exact: true }).fill('60');
    await expect(page.getByText('Total weight: 100 / 100', { exact: true })).toBeVisible();
    await page.getByLabel('confidence threshold', { exact: true }).fill('80'); await page.getByRole('button', { name: 'Save ranking configuration' }).click();
    await page.getByRole('button', { name: 'Use as default ranking' }).click(); await page.getByRole('button', { name: 'Preview saved scores' }).click();
    await expect(page.locator('.ranking-preview-results')).toContainText('Technical Balanced v2_clone');
    for (const theme of ['light', 'dark'] as const) {
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme); await page.setViewportSize({ width: 980, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`ranking-${theme}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Browser', exact: true }).click(); await page.getByLabel('Task', { exact: true }).fill('Inspect a public careers page');
    await expect(page.getByLabel('Allowed HTTPS origins (comma separated)', { exact: true })).toBeHidden(); await page.getByText('Scope and safety settings', { exact: true }).click();
    await expect(page.getByLabel('Allowed HTTPS origins (comma separated)', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('browser-task.png'), fullPage: true });
    const consent = page.getByLabel('I approve sending this task', { exact: false }); await consent.check(); await page.getByLabel('Task', { exact: true }).fill('A changed task'); await expect(consent).not.toBeChecked();
  } finally { await app.close(); }
  const persisted = new CareerStore(resolve(dir, 'rovdo.sqlite'));
  try { const profile = persisted.profile()!; expect(profile.intelligence!.skills[0]!.version).toBe('5'); expect(profile.intelligence!.skills[0]!.verified).toBe(true); expect(profile.intelligence!.education[0]!.graduation).toBeNull(); expect(profile.intelligence!.evidence.at(-1)!.sourceKind).toBe('user'); const ranking = persisted.rankings().find((r) => r.id === persisted.defaultRanking())!; expect(ranking.thresholds.confidence).toBe(.8); expect(ranking.weights.skills).toBe(60); expect(persisted.savedIds()).toHaveLength(1); expect(profile.facts.some((f) => f.field === 'skill' && f.value === 'Rust' && f.verified && f.source.kind === 'user')).toBe(true); } finally { persisted.close(); }
});
