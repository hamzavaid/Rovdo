import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

for (const kind of ['claude', 'codex'] as const)
  test(`connects a restricted ${kind} fixture CLI, persists its model and chats without API keys or tool readiness`, async () => {
    const name = kind === 'claude' ? 'Claude Code' : 'OpenAI Codex';
    const bin = test.info().outputPath('bin');
    const entry =
      kind === 'claude'
        ? join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
        : join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const calls = test.info().outputPath('fixture-calls.jsonl');
    await mkdir(join(entry, '..'), { recursive: true });
    // Bind fixtures to the test runner's Node, rather than an unrelated node found by a GUI PATH.
    const script = `${process.platform === 'win32' ? '' : `#!${process.execPath}\n`}
const fs=require('node:fs');
if(process.argv.includes('--version')){console.log(${JSON.stringify(kind === 'claude' ? '2.1.248 (Claude Code)' : 'codex-cli 0.165.0')});process.exit(0);}
if(${JSON.stringify(kind)}==='claude' && (!process.argv.includes('--restricted')||!process.argv.includes('--strict-mcp-config')||process.argv[process.argv.indexOf('--tools')+1]!==''))process.exit(8);
if(${JSON.stringify(kind)}==='codex' && (!process.argv.includes('features.shell_tool=false')||!process.argv.includes('approval_policy="never"')))process.exit(8);
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({input,args:process.argv.slice(2)})+'\\n');
const text='Fixture CLI response';
if(${JSON.stringify(kind)}==='codex'){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:3,output_tokens:2}}));return;}
console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}));
setTimeout(()=>console.log(JSON.stringify({type:'result',is_error:false,result:text})),30);
});`;
    await writeFile(entry, script);
    if (process.platform === 'win32') await writeFile(join(bin, `${kind}.cmd`), '@echo off\n');
    else await writeFile(join(bin, kind), script, { mode: 0o755 });
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    env.PATH = bin + delimiter + env.PATH;
    if (kind === 'codex') {
      const home = test.info().outputPath('isolated-home');
      await mkdir(home, { recursive: true });
      env.HOME = home;
      env.USERPROFILE = home;
    }
    const launch = () =>
      electron.launch({
        args: [resolve('apps/desktop'), `--rovdo-data-dir=${test.info().outputPath('user-data')}`],
        env,
      });
    let desktop = await launch();
    try {
      let page = await desktop.firstWindow();
      page.setDefaultTimeout(5000);
      await page.getByRole('button', { name: 'Models & Privacy', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Connect your CLI' })).toBeVisible();
      const card = page.getByRole('article', { name, exact: true });
      await expect(card.getByText('Installed · test required', { exact: true })).toBeVisible({
        timeout: 20000,
      });
      await card.getByRole('button', { name: `Configure ${name}` }).click();
      if (kind === 'codex') {
        await expect(
          card.getByRole('option', { name: 'Default · Codex built-in model', exact: true }),
        ).toHaveCount(1);
        await expect(card.getByText(/Global ~\/.codex\/AGENTS.md/)).toBeVisible();
      }
      await card.getByLabel(`Model for ${name}`, { exact: true }).selectOption('__custom');
      await card.getByLabel(`Custom model ID for ${name}`).fill('fixture-model');
      await card.getByRole('button', { name: 'Save CLI preferences' }).click();
      await expect(card.getByRole('button', { name: `Test ${name}` })).toBeEnabled();
      await card.getByRole('button', { name: `Test ${name}` }).click();
      const dialog = page.getByRole('dialog', { name: `Test ${name}` });
      await expect(dialog.getByText('Reply with ROVDO_OK only.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Run connection test' })).toBeDisabled();
      await dialog.getByLabel('Allow this test request and CLI-managed usage charges').check();
      await dialog.getByRole('button', { name: 'Run connection test' }).click();
      await expect(card.getByText('Connected', { exact: true })).toBeVisible();
      const permissions = page.getByRole('dialog', { name: 'CLI access permissions' });
      await permissions.getByLabel('Chat messages', { exact: true }).check();
      await permissions.getByLabel('Selected files and folders', { exact: true }).check();
      await permissions.getByRole('button', { name: 'Save permissions' }).click();
      await expect(permissions).toHaveCount(0);
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await page
        .getByLabel('Model profile', { exact: true })
        .selectOption({ label: `CLI · ${name} · fixture-model` });
      await page.getByLabel('Message', { exact: true }).fill('Explain this fixture');
      const attached = join(bin, 'notes.txt');
      await writeFile(attached, 'Explicitly selected fixture content');
      await desktop.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, attached);
      await page.getByRole('button', { name: 'Attach files or folders' }).click();
      await page.getByRole('button', { name: 'Choose files', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
      await page.getByRole('button', { name: 'Remove notes.txt' }).click();
      await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Attach files or folders' }).click();
      await page.getByRole('button', { name: 'Choose files', exact: true }).click();
      await expect(page.locator('.usage-meter')).toBeVisible();
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(
        page.locator('.chat-message').filter({ hasText: 'Fixture CLI response' }),
      ).toBeVisible();
      await expect(page.getByText('Completed', { exact: true })).toBeVisible();
      await page.getByLabel('Message', { exact: true }).fill('Second turn');
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
      expect(logs[1]!.input).toContain('Explicitly selected fixture content');
      expect(logs[2]!.input).toContain('Explicitly selected fixture content');
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
      await page
        .locator('.cli-section')
        .screenshot({ path: test.info().outputPath('cli-dark.png') });
      await desktop.close();
      desktop = await launch();
      page = await desktop.firstWindow();
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(
        page.locator('.chat-connection').filter({ hasText: 'Chat approved' }),
      ).toBeVisible({
        timeout: 20000,
      });
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('After restart');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(
        page.locator('.chat-message').filter({ hasText: 'Fixture CLI response' }),
      ).toHaveCount(1);
      await page.screenshot({ path: test.info().outputPath('chat-dark.png') });
      await page.setViewportSize({ width: 900, height: 680 });
      const send = page.getByRole('button', { name: 'Send message', exact: true });
      await expect(send).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Models & Privacy', exact: true }).click();
      const restored = page.getByRole('article', { name, exact: true });
      await expect(restored.getByText('Connected', { exact: true })).toBeVisible();
      await restored.getByRole('button', { name: 'Revoke access', exact: true }).click();
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(
        page.locator('.chat-connection').filter({ hasText: 'Approval required' }),
      ).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(page.locator('.chat-message')).toHaveCount(0);
      const restartedCalls = (await readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { input: string });
      expect(restartedCalls).toHaveLength(4); // No connection test or inference during restart/detection.
      expect(restartedCalls.at(-1)!.input).not.toContain('Explicitly selected fixture content');
    } finally {
      await desktop.close();
    }
  });
