import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { _electron as electron, expect, test } from '@playwright/test';
import { completion } from '../../packages/providers/src/fixtures';

test('persists settings, uses the real OS vault, probes and chats with a local fixture', async () => {
  let calls = 0;
  const secret = `rovdo-test-${randomUUID()}`;
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions' || request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
    const fixture = completion('compatible', ++calls <= 2, 'Hello from the local fixture.');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const content = await fixture.text();
    response.write(content.slice(0, 120));
    setTimeout(() => response.end(content.slice(120)), 30);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const dataDir = test.info().outputPath('user-data');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let desktop = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${dataDir}`], env });
  const diagnostics: string[] = [];
  const capture = () => {
    desktop.process().stdout?.on('data', (chunk: Buffer) => diagnostics.push(chunk.toString()));
    desktop.process().stderr?.on('data', (chunk: Buffer) => diagnostics.push(chunk.toString()));
  };
  capture();
  let account = '';
  try {
    let page = await desktop.firstWindow();
    await page.getByRole('button', { name: 'Models & Privacy' }).click();
    await page.getByRole('button', { name: 'New profile' }).click();
    await page.getByLabel('Profile name').fill('Local fixture');
    await page.getByLabel('Provider type').selectOption('compatible');
    await page.getByLabel('Endpoint URL').fill(baseUrl);
    await page.getByLabel('Model ID').fill('fixture-model');
    await page.getByLabel('Input USD per million tokens', { exact: true }).fill('1');
    await page.getByLabel('Output USD per million tokens').fill('2');
    await page.getByLabel('Cached input USD per million tokens').fill('0.5');
    await page.getByLabel('Pricing version').fill('fixture-v1');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    const profileId = await page.evaluate(async () => {
      const result = await window.rovdo!.getSettings();
      if (!result.ok) throw new Error('Settings unavailable');
      return result.settings.profiles[0]!.config.id;
    });
    expect(await page.evaluate(async (profileId) => {
      try {
        const enter = window.rovdo!.enterKey as (input: unknown) => Promise<unknown>;
        await enter({ profileId, apiKey: 'renderer-injection-canary' });
        return false;
      } catch { return true; }
    }, profileId)).toBe(true);
    account = `${profileId}:${createHash('sha256').update(`compatible:${baseUrl}`).digest('hex')}`;
    // This is privileged test instrumentation, never a production bridge method.
    await desktop.evaluate(async ({ app }, values) => {
      const load = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
      const { AsyncEntry } = load('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
      const entry = new AsyncEntry('Rovdo', values.account, { linux: { store: 'secret-service' } });
      await entry.setPassword(values.secret);
    }, { account, secret });
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.getByText('Key stored in OS vault')).toBeVisible();
    await page.getByLabel('Allow the connection test to send a small tool-call prompt to this endpoint').check();
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connection verified: streaming and tools.')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath('byok-models.png'), fullPage: true });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const modelBefore = await page.getByLabel('Model profile', { exact: true }).boundingBox();
    await page.getByRole('button', { name: 'Budget & destination', exact: true }).click();
    const [modelAfter, budget] = await Promise.all([page.getByLabel('Model profile', { exact: true }).boundingBox(), page.getByLabel('Estimated spend limit (USD)', { exact: true }).boundingBox()]);
    expect(modelAfter!.y).toBe(modelBefore!.y); expect(budget!.y).toBeGreaterThan(modelAfter!.y + modelAfter!.height);
    await page.screenshot({ path: test.info().outputPath('chat-budget.png'), fullPage: true });
    await page.getByRole('button', { name: 'Budget & destination', exact: true }).click();
    await page.getByLabel('Message').fill('Tell me about this workspace.');
    await page.getByLabel('Allow sending this conversation to the selected endpoint').check();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Hello from the local fixture.', { exact: true })).toBeVisible();
    await expect(page.getByText('workspace_info completed')).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(secret);
    const accounting = await page.evaluate(() => window.rovdo!.getSettings());
    expect(accounting.ok && accounting.settings.usage.requests).toBe(3);
    await page.evaluate(() => window.scrollTo(0, 0));
    const [conversation, composer] = await Promise.all([page.getByRole('region', { name: 'Conversation', exact: true }).boundingBox(), page.locator('.composer').boundingBox()]);
    expect(conversation!.y + conversation!.height).toBeLessThanOrEqual(composer!.y);
    await page.screenshot({ path: test.info().outputPath('byok-chat.png'), fullPage: true });
    await desktop.close();
    desktop = await electron.launch({ args: [resolve('apps/desktop'), `--rovdo-data-dir=${dataDir}`], env });
    capture();
    page = await desktop.firstWindow();
    await page.getByRole('button', { name: 'Models & Privacy' }).click();
    await page.getByRole('button', { name: 'Edit Local fixture' }).click();
    await expect(page.getByLabel('Model ID')).toHaveValue('fixture-model');
    await expect(page.getByText('Key stored in OS vault')).toBeVisible();
    await expect(page.getByText('Tools: supported')).toBeVisible();
    await page.getByRole('button', { name: 'Remove key' }).click();
    await expect(page.getByText('No key stored')).toBeVisible();
    await desktop.close();
    expect((await readFile(resolve(dataDir, 'rovdo.sqlite'))).includes(Buffer.from(secret))).toBe(false);
    expect(diagnostics.join('')).not.toContain(secret);
    expect(calls).toBe(3);
  } finally {
    // Idempotent cleanup for failures before the settings UI removes the canary.
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      if (account) await new AsyncEntry('Rovdo', account, { linux: { store: 'secret-service' } }).deleteCredential();
    } catch { /* No raw native errors in diagnostics. */ }
    try { await desktop.close(); } catch { /* Already closed. */ }
    await new Promise<void>((done) => server.close(() => done()));
  }
});
