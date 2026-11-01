import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '@rovdo/storage';
import {
  CliService,
  CLI_PROVIDERS,
  claudeArguments,
  parseClaudeLine,
  OllamaCliAdapter,
  claudeConfiguredModel,
} from './cli-service';
import { completion } from '../../../../packages/providers/src/fixtures';
import { CliPreferenceSchema } from '@rovdo/shared';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CLI provider isolation and configuration', () => {
  it('reuses the compatible transport for Ollama text with no tools, credentials or fabricated costs', async () => {
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      expect(req.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
      expect(req.headers.has('authorization')).toBe(false);
      const body = (await req.json()) as { tools?: unknown; model: string };
      expect(body.tools).toBeUndefined();
      expect(body.model).toBe('fixture:local');
      return completion('compatible', false, 'Local fixture');
    });
    const adapter = new OllamaCliAdapter('fixture:local', 5000, transport);
    const caps = await adapter.probe(new AbortController().signal);
    expect(caps.tools).toBe('unsupported');
    expect(caps.streaming).toBe('supported');
    expect(adapter.estimateCost()).toBe(null);
  });
  it('reads only a bounded configured Claude model, never auth files or other settings into the prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovdo-cli-model-'));
    try {
      await writeFile(
        join(root, 'settings.json'),
        JSON.stringify({
          model: 'sonnet',
          apiKeyHelper: 'secret-canary',
          hooks: { command: 'never-run' },
        }),
      );
      expect(await claudeConfiguredModel(root)).toBe('sonnet');
      await writeFile(join(root, 'settings.json'), JSON.stringify({ model: '--bad' }));
      await expect(claudeConfiguredModel(root)).rejects.toThrow('CLI_MODEL_INVALID');
      await writeFile(join(root, 'settings.json'), 'x'.repeat(70000));
      await expect(claudeConfiguredModel(root)).rejects.toThrow('CLI_UNSUPPORTED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('detects versions and streams a real mocked process without reading credential files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rovdo-cli-service-'));
    const script = join(root, 'mock.cjs');
    await writeFile(
      script,
      `if(process.argv.includes('--version')){console.log('2.1.248 (Claude Code)');process.exit(0);}let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{if(!input.includes('conversation')||!process.argv.includes('--restricted'))process.exit(9);console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'hello'}}}));console.log(JSON.stringify({type:'result',is_error:false,result:'hello'}));});`,
    );
    const store = new SettingsStore(':memory:');
    const service = new CliService(store, {
      find: async (id) =>
        id === 'claude' ? { executable: process.execPath, prefix: [script] } : null,
    });
    try {
      await service.scan();
      expect(service.views().find((v) => v.id === 'claude')).toMatchObject({
        version: '2.1.248',
        status: 'installed',
        text: 'unknown',
      });
      await service.test('claude', new AbortController().signal);
      expect(service.views().find((v) => v.id === 'claude')).toMatchObject({
        status: 'connected',
        text: 'supported',
        streaming: 'supported',
      });
      const adapter = await service.adapter('claude');
      const chunks: string[] = [];
      const result = await adapter.generate(
        { messages: [{ role: 'user', content: 'conversation $() &' }], tools: [] },
        new AbortController().signal,
        (s) => chunks.push(s),
      );
      expect(result.text).toBe('hello');
      expect(chunks).toEqual(['hello']);
      expect(adapter.estimateCost(result.usage)).toBe(null);
      service.save({ id: 'claude', model: 'other', timeoutMs: 30000 });
      expect(service.views().find((v) => v.id === 'claude')?.status).toBe('installed');
    } finally {
      await service.shutdown();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    ['2.1.247', 'unsupported-version'],
    ['3.0.0', 'unsupported-version'],
    ['2.1.248', 'installed'],
  ])('checks Claude restricted-mode version %s', async (version, status) => {
    const store = new SettingsStore(':memory:');
    const runtime = {
      run: vi.fn(async () => ({ stdout: version, stderr: '', exitCode: 0 })),
      shutdown: async () => {},
    };
    const service = new CliService(store, {
      find: async (id) => (id === 'claude' ? { executable: process.execPath, prefix: [] } : null),
      runtime: runtime as unknown as import('./cli-runtime').CliRuntime,
    });
    try {
      await service.scan();
      expect(service.views().find((v) => v.id === 'claude')?.status).toBe(status);
    } finally {
      await service.shutdown();
      store.close();
    }
  });
  it.each([
    ['Please login: secret-canary', 'AUTH_FAILED'],
    ['Model not found: secret-canary', 'CLI_MODEL_INVALID'],
    ['secret-canary', 'CLI_EXECUTION_FAILED'],
  ])('maps execution errors to fixed codes', async (stderr, code) => {
    const store = new SettingsStore(':memory:');
    const runtime = {
      run: vi.fn(async (_launcher: unknown, args: string[]) =>
        args.includes('--version')
          ? { stdout: '2.1.248', stderr: '', exitCode: 0 }
          : { stdout: '', stderr, exitCode: 1 },
      ),
      shutdown: async () => {},
    };
    const service = new CliService(store, {
      find: async (id) => (id === 'claude' ? { executable: process.execPath, prefix: [] } : null),
      runtime: runtime as unknown as import('./cli-runtime').CliRuntime,
    });
    try {
      await service.scan();
      await expect(service.test('claude', new AbortController().signal)).rejects.toThrow(code);
      expect(JSON.stringify(service.views())).not.toContain('secret-canary');
      if (code === 'AUTH_FAILED')
        expect(service.views().find((v) => v.id === 'claude')?.status).toBe(
          'authentication-required',
        );
    } finally {
      await service.shutdown();
      store.close();
    }
  });
  it('rejects executable paths, commands and unsafe model IDs', () => {
    for (const model of ['--help', 'x;rm', '$(secret)', 'a b', '../secret'])
      expect(CliPreferenceSchema.safeParse({ id: 'claude', model, timeoutMs: 30000 }).success).toBe(
        false,
      );
    expect(
      CliPreferenceSchema.safeParse({
        id: 'claude',
        model: 'sonnet',
        timeoutMs: 30000,
        path: '/bin/sh',
      }).success,
    ).toBe(false);
  });
  it('persists only model preferences independently, with non-destructive API compatibility', () => {
    const store = new SettingsStore(':memory:');
    try {
      store.saveCli({ id: 'claude', model: 'sonnet', timeoutMs: 30000 });
      store.saveCli({ id: 'ollama', model: 'qwen3:8b', timeoutMs: 60000 });
      expect(store.cliPreferences()).toHaveLength(2);
      expect(store.list()).toEqual([]);
      expect(() => store.saveCli({ id: 'claude', model: '--bad', timeoutMs: 30000 })).toThrow(
        'VALIDATION_ERROR',
      );
    } finally {
      store.close();
    }
  });
  it('uses restricted, no-tools/no-MCP/no-hooks Claude flags and never embeds prompts in argv', () => {
    const args = claudeArguments('sonnet');
    expect(args).toContain('--restricted');
    expect(args).toContain('--tools');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(
      parseClaudeLine(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
        }),
      ),
    ).toEqual({ text: 'hello' });
    expect(() =>
      parseClaudeLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read' }] },
        }),
      ),
    ).toThrow('CAPABILITY_REQUIRED');
  });
  it('reports missing CLIs, caches scans and refuses unrestricted adapters before launching inference', async () => {
    const store = new SettingsStore(':memory:');
    const find = vi.fn(async () => null);
    const service = new CliService(store, { find });
    try {
      expect(await service.scan()).toHaveLength(5);
      expect(find).toHaveBeenCalledTimes(5);
      await service.scan();
      expect(find).toHaveBeenCalledTimes(5);
      await service.scan(true);
      expect(find).toHaveBeenCalledTimes(10);
      expect(service.views().every((v) => v.status === 'not-installed')).toBe(true);
      for (const id of ['codex', 'gemini', 'qwen'] as const) {
        expect(CLI_PROVIDERS[id].restricted).toBe(false);
        await expect(service.adapter(id)).rejects.toThrow('CAPABILITY_REQUIRED');
      }
    } finally {
      await service.shutdown();
      store.close();
    }
  });
});
