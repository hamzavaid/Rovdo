import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
test('Search All Companies collects fixture feeds without employer identifiers or AI', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const app = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('automatic-data')}`], env });
  try {
    // Test-only main-process instrumentation. No transport flags or weakened DNS
    // permissions are shipped in production, and no real HTTP request is made.
    await app.evaluate(async () => {
      const { createRequire } = process.getBuiltinModule('node:module'); const require = createRequire(process.cwd() + '/fixture.cjs');
      const { EventEmitter } = process.getBuiltinModule('node:events');
      (require('node:dns/promises') as { lookup: unknown }).lookup = async () => [{ address: '93.184.216.34', family: 4 }];
      (require('node:https') as { request: unknown }).request = (url: URL, _options: unknown, callback: (res: unknown) => void) => {
        const title = 'Fixture TypeScript Engineer'; const content = 'Required skills: TypeScript';
        const data = url.hostname.includes('greenhouse') ? { jobs: [{ id: 1, title, content, location: { name: 'Remote' }, absolute_url: 'https://employer.test/figma/1' }] } : url.hostname.includes('lever') ? [{ id: '1', text: title, descriptionPlain: content, hostedUrl: 'https://employer.test/palantir/1', categories: { location: 'Remote' } }] : url.hostname.includes('ashbyhq') ? { jobs: [{ id: '1', title, descriptionPlain: content, jobUrl: 'https://employer.test/linear/1', location: 'Remote', isRemote: true }] } : url.hostname.includes('smartrecruiters') ? { content: [], totalFound: 0 } : null;
        if (!data) throw new Error('Unexpected fixture destination');
        const request = Object.assign(new EventEmitter(), { end() { queueMicrotask(() => { const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} }); callback(response); response.emit('data', Buffer.from(JSON.stringify(data))); response.emit('end'); }); }, destroy() {} });
        return request;
      };
    });
    const page = await app.firstWindow(); await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.job-card')).toHaveCount(3, { timeout: 15000 });
    await expect(page.getByText(/4 directory sources/)).toBeVisible();
    await page.getByRole('button', { name: 'Sources & coverage', exact: true }).click();
    await page.getByText('Verified source directory', { exact: true }).click();
    const entry = page.locator('.directory-entry').first();
    const heading = entry.locator('h3'); const toggle = entry.locator('.directory-heading button');
    const bounds = await Promise.all([heading.boundingBox(), toggle.boundingBox(), entry.locator('.directory-provenance').boundingBox()]);
    expect(bounds[1]!.x).toBeGreaterThanOrEqual(bounds[0]!.x + bounds[0]!.width);
    expect(bounds[2]!.y).toBeGreaterThanOrEqual(bounds[1]!.y + bounds[1]!.height);
    await entry.screenshot({ path: test.info().outputPath('source-directory-entry.png') });
    const settings = await page.evaluate(() => window.rovdo!.getSettings()); expect(settings.ok && settings.settings.profiles.length).toBe(0);
    const result = await page.evaluate(() => window.rovdo!.careerCommand({ op: 'view', search: { query: '', company: '', workMode: 'all', savedOnly: false, includeExcluded: false } }));
    expect(result.ok && result.view.sources.every((s) => s.state.status === 'OK' || s.state.status === 'EMPTY_SOURCE')).toBe(true);
  } finally { await app.close(); }
});
