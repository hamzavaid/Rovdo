import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '@rovdo/storage';
import { CliService, CLI_PROVIDERS, claudeArguments, parseClaudeLine } from './cli-service';
import { CliPreferenceSchema } from '@rovdo/shared';

describe('CLI provider isolation and configuration', () => {
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
