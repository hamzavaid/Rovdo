/** Reviewed against Codex 0.165.0 with a hostile local Responses server; never infer safety from --version alone. */
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliModelSchema } from '@rovdo/shared';
import type { Usage } from '@rovdo/shared';

export const CODEX_ISOLATED_VERSION = '0.165.0';
// Disable every reviewed tool family, not just shell execution. Read-only/never is a second boundary:
// 0.165.0 still dispatches forged apply_patch calls even when the model receives tools: [].
const disabled = [
  'shell_tool',
  'unified_exec',
  'js_repl',
  'js_repl_tools_only',
  'code_mode',
  'code_mode_host',
  'code_mode_only',
  'code_mode_tool_search',
  'tool_search',
  'search_tool',
  'standalone_web_search',
  'view_image',
  'image_generation',
  'multi_agent',
  'multi_agent_v2',
  'multi_agent_mode',
  'apps',
  'plugins',
  'remote_plugin',
  'plugin_hooks',
  'hooks',
  'browser_use',
  'computer_use',
  'goals',
  'memories',
  'request_permissions_tool',
  'skill_search',
  'tool_suggest',
  'sleep_tool',
  'agent_message_board',
  'send_async_message',
  'send_message_to_user_async',
  'exec_permission_approvals',
];
export function codexArguments(model: string): string[] {
  if (!CliModelSchema.safeParse(model).success) throw new Error('CLI_MODEL_INVALID');
  const config = [
    'approval_policy="never"',
    'web_search="disabled"',
    'agents.enabled=false',
    'tools.update_plan.enabled=false',
    'project_doc_max_bytes=0',
    'skills.include_instructions=false',
    'check_for_update_on_startup=false',
    'features.skip_host_skill_discovery=true',
    'include_environment_context=false',
    'include_apps_instructions=false',
    ...disabled.map((name) => `features.${name}=false`),
  ];
  return [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    ...config.flatMap((value) => ['-c', value]),
    ...(model ? ['--model', model] : []),
    '-',
  ];
}

/** No credential files are read/copied. Codex keeps its existing auth home, but must not auto-send global guidance. */
export async function assertCodexHome(home = join(homedir(), '.codex')): Promise<void> {
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
    try {
      const info = await stat(join(home, name));
      if (!info.isFile() || info.size !== 0) throw new Error('CLI_ISOLATION_REQUIRED');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        continue;
      throw new Error('CLI_ISOLATION_REQUIRED', { cause: error });
    }
  }
}

export function codexFailure(value: string): Error {
  return new Error(
    /auth|login|log in|unauthorized|401|credential/i.test(value)
      ? 'AUTH_FAILED'
      : /model.*(not found|invalid|unavailable)|model_not_found/i.test(value)
        ? 'CLI_MODEL_INVALID'
        : 'CLI_EXECUTION_FAILED',
  );
}
type CodexLine = { text?: string; done?: boolean; usage?: Usage };
export function parseCodexLine(line: string): CodexLine {
  const event: unknown = JSON.parse(line);
  if (!event || typeof event !== 'object' || !('type' in event))
    throw new Error('INVALID_RESPONSE');
  const value = event as Record<string, unknown>;
  if (value.type === 'thread.started' || value.type === 'turn.started') return {};
  if (value.type === 'error' || value.type === 'turn.failed')
    throw codexFailure(JSON.stringify(value.error ?? value.message ?? ''));
  if (value.type === 'turn.completed') {
    const u = value.usage as Record<string, unknown> | undefined;
    if (
      !u ||
      !Number.isSafeInteger(u.input_tokens) ||
      !Number.isSafeInteger(u.output_tokens) ||
      (u.input_tokens as number) < 0 ||
      (u.output_tokens as number) < 0 ||
      (u.cached_input_tokens !== undefined &&
        (!Number.isSafeInteger(u.cached_input_tokens) ||
          (u.cached_input_tokens as number) < 0 ||
          (u.cached_input_tokens as number) > (u.input_tokens as number)))
    )
      throw new Error('INVALID_RESPONSE');
    return {
      done: true,
      usage: {
        inputTokens: u.input_tokens as number,
        outputTokens: u.output_tokens as number,
        ...(u.cached_input_tokens === undefined
          ? {}
          : { cachedInputTokens: u.cached_input_tokens as number }),
        source: 'reported',
      },
    };
  }
  if (['item.started', 'item.updated', 'item.completed'].includes(value.type as string)) {
    const item = value.item as Record<string, unknown> | undefined;
    if (!item || typeof item.type !== 'string') throw new Error('INVALID_RESPONSE');
    if (item.type === 'agent_message') {
      if (value.type !== 'item.completed') return {};
      if (typeof item.text !== 'string') throw new Error('INVALID_RESPONSE');
      return { text: item.text };
    }
    if (item.type === 'reasoning') return {};
    // Only the two observed, fixed startup warnings are harmless. Never forward raw diagnostics.
    if (
      item.type === 'error' &&
      typeof item.message === 'string' &&
      (item.message.startsWith('Under-development features enabled: skip_host_skill_discovery.') ||
        item.message ===
          'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.')
    )
      return {};
    throw new Error('CLI_ISOLATION_REQUIRED');
  }
  throw new Error('INVALID_RESPONSE');
}
