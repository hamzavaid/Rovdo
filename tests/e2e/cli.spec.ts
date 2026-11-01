import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('connects a restricted fixture CLI, persists its model and chats without API keys or tool readiness', async () => {
  const bin = test.info().outputPath('bin');
  const entry = join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  const calls = test.info().outputPath('fixture-calls.jsonl');
  await mkdir(join(bin, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
  const script = `${process.platform === 'win32' ? '' : '#!/usr/bin/env node\n'}
const fs=require('node:fs');
if(process.argv.includes('--version')){console.log('2.1.248 (Claude Code)');process.exit(0);}
if(!process.argv.includes('--restricted')||!process.argv.includes('--strict-mcp-config')||process.argv[process.argv.indexOf('--tools')+1]!=='')process.exit(8);
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({input,args:process.argv.slice(2)})+'\\n');
const text='Fixture CLI response';
console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}));
setTimeout(()=>console.log(JSON.stringify({type:'result',is_error:false,result:text})),30);
});`;
  await writeFile(entry, script);
  if (process.platform === 'win32') await writeFile(join(bin, 'claude.cmd'), '@echo off\n');
  else await writeFile(join(bin, 'claude'), script, { mode: 0o755 });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  env.PATH = bin + delimiter + env.PATH;
  const desktop = await electron.launch({
    args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('user-data')}`],
    env,
  });
  try {
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(5000);
    await page.getByRole('button', { name: 'Models & Privacy', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect your CLI' })).toBeVisible();
    const card = page.getByRole('article', { name: 'Claude Code', exact: true });
    await expect(card.getByText('Installed · test required', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await card.getByRole('button', { name: 'Configure Claude Code' }).click();
    await card.getByLabel('Model for Claude Code', { exact: true }).selectOption('__custom');
    await card.getByLabel('Custom model ID for Claude Code').fill('fixture-model');
    await card.getByRole('button', { name: 'Save CLI preferences' }).click();
    await expect(card.getByRole('button', { name: 'Test Claude Code' })).toBeEnabled();
    await card.getByRole('button', { name: 'Test Claude Code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test Claude Code' });
    await expect(dialog.getByText('Reply with ROVDO_OK only.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Run connection test' })).toBeDisabled();
    await dialog.getByLabel('Allow this test request and CLI-managed usage charges').check();
    await dialog.getByRole('button', { name: 'Run connection test' }).click();
    await expect(card.getByText('Connected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page
      .getByLabel('Model profile', { exact: true })
      .selectOption({ label: 'CLI · Claude Code · fixture-model' });
    await page.getByLabel('Message', { exact: true }).fill('Explain this fixture');
    await expect(page.locator('.usage-meter')).toBeVisible();
    await page
      .getByLabel(
        'Allow sending this conversation through the selected CLI; cost is managed by the CLI',
      )
      .check();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      page.locator('.chat-message').filter({ hasText: 'Fixture CLI response' }),
    ).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await page.getByLabel('Message', { exact: true }).fill('Second turn');
    await page
      .getByLabel(
        'Allow sending this conversation through the selected CLI; cost is managed by the CLI',
      )
      .check();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(
      page.locator('.chat-message').filter({ hasText: 'Fixture CLI response' }),
    ).toHaveCount(2);
    const logs = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { input: string; args: string[] });
    expect(logs).toHaveLength(3);
    expect(logs[2]!.input).toContain('Explain this fixture');
    expect(logs[2]!.input).toContain('Second turn');
    expect(logs[2]!.args).not.toContain('Second turn');
    const settings = await page.evaluate(() => window.rovdo!.getSettings());
    expect(settings.ok && settings.settings.profiles).toEqual([]);
    await page.getByRole('button', { name: 'Models & Privacy', exact: true }).click();
    await expect(card.getByText('fixture-model', { exact: true }).first()).toBeVisible();
    await page.getByLabel('Appearance', { exact: true }).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page
      .locator('.cli-section')
      .screenshot({ path: test.info().outputPath('cli-light.png') });
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.cli-section').screenshot({ path: test.info().outputPath('cli-dark.png') });
  } finally {
    await desktop.close();
  }
});
