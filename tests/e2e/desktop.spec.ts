import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('boots the built shell with isolated preload and blocked egress', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const desktop = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('user-data')}`], env });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: 'Your workspace starts here.' })).toBeVisible();
    await expect(page.getByText('Browser + Jobs')).toBeVisible();
    await expect(page.getByText('Desktop connected')).toBeVisible();
    expect(page.url()).toBe('rovdo://app/index.html');

    await expect(page.getByRole('img', { name: 'Rovdo', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.brand img, .panel-symbol').evaluateAll((images) =>
      images.length === 2 && images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
    )).toBe(true);

    const isolation = await page.evaluate(async () => {
      const scope = globalThis as unknown as Record<string, unknown>;
      const api = scope.rovdo as { getAppInfo(): Promise<unknown> };
      return {
        node: typeof scope.require,
        process: typeof scope.process,
        bridgeKeys: Object.keys(api),
        info: await api.getAppInfo(),
        blocked: await fetch('https://example.com').then(() => false, () => true),
      };
    });
    expect(isolation).toEqual({
      node: 'undefined', process: 'undefined', bridgeKeys: ['careerCommand', 'browserCommand', 'getAppInfo', 'getSettings', 'saveProfile', 'removeProfile', 'enterKey', 'removeKey', 'testConnection', 'startChat', 'cancelChat', 'clearChat', 'onChatEvent'],
      info: { name: 'Rovdo', version: '0.1.0', milestone: 'career-jobs', networkEnabled: false },
      blocked: true,
    });

    if (process.platform !== 'linux') {
      expect(await desktop.evaluate(({ app, BrowserWindow }) => {
        const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
        return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
      })).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath('foundation-shell.png') });
  } finally {
    await desktop.close();
  }
});
