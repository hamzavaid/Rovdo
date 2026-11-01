/** These tests assert restrictions, not a prompt asking the model to behave safely. */
import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertCodexHome, codexArguments, parseCodexLine } from './codex-isolation';

it('pins tool isolation, ignores configuration/rules and uses stdin rather than prompt arguments', () => {
  const args = codexArguments('fixture-model');
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--strict-config', '--ephemeral'])
    expect(args).toContain(flag);
  expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  for (const config of [
    'approval_policy="never"',
    'features.shell_tool=false',
    'features.unified_exec=false',
    'features.apps=false',
    'features.plugins=false',
    'features.hooks=false',
    'features.multi_agent=false',
    'agents.enabled=false',
    'tools.update_plan.enabled=false',
    'web_search="disabled"',
    'project_doc_max_bytes=0',
    'include_environment_context=false',
    'skills.include_instructions=false',
  ])
    expect(args).toContain(config);
  expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  expect(() => codexArguments('--help')).toThrow('CLI_MODEL_INVALID');
});

it('refuses global instructions rather than quietly sending private context to a provider', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rovdo-codex-home-'));
  try {
    await expect(assertCodexHome(home)).resolves.toBeUndefined();
    await writeFile(join(home, 'AGENTS.md'), 'private canary');
    await expect(assertCodexHome(home)).rejects.toThrow('CLI_ISOLATION_REQUIRED');
    await writeFile(join(home, 'AGENTS.md'), '');
    await expect(assertCodexHome(home)).resolves.toBeUndefined();
    await writeFile(join(home, 'AGENTS.override.md'), 'private canary');
    await expect(assertCodexHome(home)).rejects.toThrow('CLI_ISOLATION_REQUIRED');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it('validates text and reported usage, rejects agent/tool events and sanitized failures', () => {
  expect(
    parseCodexLine(
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello' } }),
    ),
  ).toEqual({ text: 'hello' });
  expect(
    parseCodexLine(
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 3 },
      }),
    ),
  ).toEqual({
    done: true,
    usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 4, source: 'reported' },
  });
  for (const type of [
    'command_execution',
    'file_change',
    'mcp_tool_call',
    'web_search',
    'collab_tool_call',
    'unknown_future_tool',
  ])
    expect(() => parseCodexLine(JSON.stringify({ type: 'item.started', item: { type } }))).toThrow(
      'CLI_ISOLATION_REQUIRED',
    );
  expect(() =>
    parseCodexLine(
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 3 } }),
    ),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseCodexLine(
      JSON.stringify({ type: 'turn.failed', error: { message: '401 private secret' } }),
    ),
  ).toThrow('AUTH_FAILED');
  expect(() =>
    parseCodexLine(JSON.stringify({ type: 'error', message: 'private secret' })),
  ).toThrow('CLI_EXECUTION_FAILED');
  expect(() => parseCodexLine(JSON.stringify({ type: 'future.protocol' }))).toThrow(
    'INVALID_RESPONSE',
  );
});
