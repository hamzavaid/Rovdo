import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('dictates into a draft only, stops on navigation, and keeps the composer reachable', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const desktop = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('user-data')}`],
    env,
  });
  try {
    const page = await desktop.firstWindow();
    // Fixture only: preserve the real preload schema/event boundary without opening a microphone.
    await desktop.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('chat:dictation');
      ipcMain.handle('chat:dictation', (event, command: { op: string; requestId?: string }) => {
        if (command.op === 'start') {
          event.sender.send('chat:event', {
            type: 'dictation',
            requestId: command.requestId,
            state: 'listening',
          });
          for (const state of ['processing', 'interim', 'text', 'text'])
            event.sender.send('chat:event', {
              type: 'dictation',
              requestId: command.requestId,
              state,
              segment: 0,
              text: 'A dictated draft',
            });
        }
        if (command.op === 'stop') {
          event.sender.send('chat:event', {
            type: 'dictation',
            requestId: command.requestId,
            state: 'stopped',
          });
          setTimeout(
            () =>
              event.sender.send('chat:event', {
                type: 'dictation',
                requestId: command.requestId,
                state: 'text',
                text: 'LATE',
              }),
            50,
          );
        }
        return { ok: true, supported: true };
      });
    });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const mic = page.getByRole('button', { name: 'Start dictation', exact: true });
    await expect(mic).toBeEnabled();
    await mic.click();
    const consent = page.getByRole('dialog', { name: 'Local voice dictation' });
    await expect(consent.getByRole('button', { name: 'Start listening' })).toBeDisabled();
    await consent.getByLabel('Allow microphone access for local dictation').check();
    await consent.getByRole('button', { name: 'Start listening' }).click();
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(message).toHaveValue('A dictated draft');
    await expect(page.getByText('Listening locally...', { exact: false })).toBeVisible();
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    await expect(mic).toBeVisible();
    await expect(message).toHaveValue('A dictated draft');
    await mic.click(); // Consent is kept for this session, never inferred from model authorization.
    await expect(message).toHaveValue('A dictated draft A dictated draft');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(mic).toBeVisible();
    await expect(message).not.toHaveValue(/LATE/);
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
      await page.setViewportSize({ width: 900, height: 680 });
      await expect(
        page.getByRole('button', { name: 'Send message', exact: true }),
      ).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: test.info().outputPath(`chat-${theme}.png`) });
    }
  } finally {
    await desktop.close();
  }
});
