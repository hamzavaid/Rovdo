import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliRuntime, executableCandidates, resolveLauncher, cliEnvironment } from './cli-runtime';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(code: string) {
  const dir = await mkdtemp(join(tmpdir(), 'rovdo-cli-test-'));
  dirs.push(dir);
  const script = join(dir, 'fixture.cjs');
  await writeFile(script, code);
  return { executable: process.execPath, prefix: [script] };
}
describe('bounded local CLI runtime', () => {
  it('scrubs ambient credentials, loader injection and provider overrides', () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'secret-canary';
    try {
      const env = cliEnvironment();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(env.OLLAMA_HOST).toBeUndefined();
      expect(JSON.stringify(env)).not.toContain('secret-canary');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
  it('shuts down active processes and prevents new work', async () => {
    const launcher = await fixture('setInterval(()=>{},1000);');
    const runtime = new CliRuntime();
    const pending = runtime.run(launcher, [], '', new AbortController().signal, 2000);
    // run has an asynchronous temporary-directory boundary; shutdown must also stop pre-spawn work.
    await runtime.shutdown();
    await expect(pending).rejects.toThrow('CANCELED');
    expect(runtime.size).toBe(0);
  });
  it('transports shell metacharacters only through stdin and streams split UTF-8 safely', async () => {
    const launcher = await fixture("process.stdin.on('data',b=>process.stdout.write(b));");
    const runtime = new CliRuntime();
    const chunks: string[] = [];
    const input = 'Hello café $(touch nope) & | " ;';
    const result = await runtime.run(launcher, [], input, new AbortController().signal, 2000, (s) =>
      chunks.push(s),
    );
    expect(result.stdout).toBe(input);
    expect(chunks.join('')).toBe(input);
    expect(result.exitCode).toBe(0);
  });
  it('bounds output and never exposes child stderr in exceptions', async () => {
    const launcher = await fixture(
      "process.stderr.write('secret-canary'); process.stdout.write('x'.repeat(2000000));setInterval(()=>{},1000);",
    );
    await expect(
      new CliRuntime().run(launcher, [], '', new AbortController().signal, 2000),
    ).rejects.toThrow('INVALID_RESPONSE');
  });
  it('cancels, times out, cleans up and rejects an already aborted request', async () => {
    const launcher = await fixture('setInterval(()=>{},1000);');
    const runtime = new CliRuntime();
    const controller = new AbortController();
    const pending = runtime.run(launcher, [], '', controller.signal, 2000);
    controller.abort();
    await expect(pending).rejects.toThrow('CANCELED');
    await expect(runtime.run(launcher, [], '', new AbortController().signal, 30)).rejects.toThrow(
      'TIMEOUT',
    );
    await expect(runtime.run(launcher, [], '', controller.signal, 1000)).rejects.toThrow(
      'CANCELED',
    );
    await runtime.shutdown();
    expect(runtime.size).toBe(0);
  });
  it('resolves allowlisted names on all platforms, ignoring relative PATH entries', () => {
    expect(
      executableCandidates('claude', 'linux', { PATH: '/usr/bin:.:relative' }, '/home/user'),
    ).toContain('/usr/bin/claude');
    expect(executableCandidates('claude', 'darwin', {}, '/Users/test')).toContain(
      '/opt/homebrew/bin/claude',
    );
    const windows = executableCandidates(
      'codex',
      'win32',
      {
        APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      },
      'C:\\Users\\test',
    );
    expect(windows).toContain(
      'C:\\Users\\test\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe',
    );
    expect(() =>
      executableCandidates('powershell' as 'codex', 'win32', {}, 'C:\\Users\\test'),
    ).toThrow('VALIDATION_ERROR');
  });
  it('unwraps only known npm package entrypoints without cmd.exe or shell execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rovdo-wrapper-'));
    dirs.push(dir);
    const cmd = join(dir, 'claude.cmd');
    const entry = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    await mkdir(join(dir, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
    await writeFile(entry, '');
    await writeFile(cmd, 'malicious wrapper contents are never executed');
    const launch = await resolveLauncher(cmd, 'claude', process.execPath);
    expect(launch).toEqual({ executable: process.execPath, prefix: [entry] });
    await expect(
      resolveLauncher(join(dir, 'evil.cmd'), 'claude', process.execPath),
    ).rejects.toThrow();
  });
  it.each([
    ['gemini', '@google/gemini-cli/bundle/gemini.js'],
    ['qwen', '@qwen-code/qwen-code/scripts/cli-entry.js'],
  ] as const)('recognizes the published %s npm entrypoint', async (id, relative) => {
    const dir = await mkdtemp(join(tmpdir(), 'rovdo-published-cli-'));
    dirs.push(dir);
    const cmd = join(dir, `${id}.cmd`);
    const entry = join(dir, 'node_modules', relative);
    await mkdir(join(entry, '..'), { recursive: true });
    await writeFile(entry, '');
    await writeFile(cmd, 'never executed');
    expect(await resolveLauncher(cmd, id, process.execPath)).toEqual({
      executable: process.execPath,
      prefix: [entry],
    });
  });
});
