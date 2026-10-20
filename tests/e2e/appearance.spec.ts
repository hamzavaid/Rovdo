import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
test('persists Light/Dark/System appearance, follows OS changes and keeps controls accessible', async () => {
  const dir = test.info().outputPath('appearance-data');
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  let app = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`],
    env,
  });
  try {
    let page = await app.firstWindow();
    await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('system');
    for (const theme of ['light', 'dark'] as const) {
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const section of [
        'Overview',
        'Chat',
        'Browser',
        'Jobs',
        'Profile',
        'Models & Privacy',
      ]) {
        await page.getByRole('button', { name: section, exact: true }).click();
        const contrast = await page.evaluate(() => {
          const s = getComputedStyle(document.documentElement);
          const rgb = (v: string) => {
            const e = document.createElement('span');
            e.style.color = v;
            document.body.append(e);
            const value = getComputedStyle(e)
              .color.match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number);
            e.remove();
            return value;
          };
          const lum = (v: number[]) =>
            v
              .map((c) => {
                const n = c / 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              })
              .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i]!, 0);
          const ratio = (a: string, b: string) => {
            const x = lum(rgb(s.getPropertyValue(a)));
            const y = lum(rgb(s.getPropertyValue(b)));
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          return {
            text: ratio('--text', '--surface'),
            muted: ratio('--muted', '--panel'),
            button: ratio('--on-accent', '--accent'),
            accent: ratio('--accent', '--panel'),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(contrast.text).toBeGreaterThanOrEqual(4.5);
        expect(contrast.muted).toBeGreaterThanOrEqual(4.5);
        expect(contrast.button).toBeGreaterThanOrEqual(4.5);
        expect(contrast.accent).toBeGreaterThanOrEqual(4.5);
        expect(contrast.overflow).toBe(false);
      }
      await page.getByRole('button', { name: 'Jobs', exact: true }).click();
      await page.screenshot({ path: test.info().outputPath(`jobs-${theme}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Profile', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Candidate profile', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Jobs', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('Advanced search filters', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Technical role family')).toBeVisible();
    await page.setViewportSize({ width: 820, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByLabel('Appearance', { exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    await page.getByLabel('Appearance', { exact: true }).selectOption('system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
    await app.close();
    app = await electron.launch({
      args: [resolve('apps/desktop'), `--rovdo-data-dir=${dir}`],
      env,
    });
    page = await app.firstWindow();
    await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  } finally {
    await app.close();
  }
});
