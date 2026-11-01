/** CLI-specific contracts. Safety is a prerequisite, not an inferred capability from successful version output. */
import { createAdapter } from '@rovdo/providers';
import type { ModelAdapter } from '@rovdo/providers';
import { CliPreferenceSchema, CliModelSchema } from '@rovdo/shared';
import type {
  AgentTurn,
  CliId,
  CliView,
  ModelCapabilities,
  NormalizedMessage,
  Usage,
} from '@rovdo/shared';
import type { SettingsStore } from '@rovdo/storage';
import { CliRuntime, findCli } from './cli-runtime';
import type { Launcher } from './cli-runtime';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  assertCodexHome,
  CODEX_ISOLATED_VERSION,
  codexArguments,
  codexFailure,
  parseCodexLine,
} from './codex-isolation';

/** Copy only the model preference, not user settings/hooks/helpers, into restricted mode. Never read auth files. */
export async function claudeConfiguredModel(
  directory = join(homedir(), '.claude'),
): Promise<string> {
  let file;
  try {
    file = await open(join(directory, 'settings.json'), 'r');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return '';
    throw new Error('CLI_EXECUTION_FAILED', { cause: error });
  }
  try {
    if ((await file.stat()).size > 65536) throw new Error('CLI_UNSUPPORTED');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error('CLI_UNSUPPORTED');
    const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (!value || typeof value !== 'object' || !('model' in value)) return '';
    const parsed = CliModelSchema.safeParse(value.model);
    if (!parsed.success) throw new Error('CLI_MODEL_INVALID');
    return parsed.data;
  } finally {
    await file.close();
  }
}

export const CLI_PROVIDERS = {
  codex: {
    name: 'OpenAI Codex',
    restricted: true,
    profileId: '9b1b7310-0604-4aaa-8000-000000000001',
  },
  claude: {
    name: 'Claude Code',
    restricted: true,
    profileId: '9b1b7310-0604-4aaa-8000-000000000002',
  },
  gemini: {
    name: 'Gemini CLI',
    restricted: false,
    profileId: '9b1b7310-0604-4aaa-8000-000000000003',
  },
  qwen: { name: 'Qwen Code', restricted: false, profileId: '9b1b7310-0604-4aaa-8000-000000000004' },
  ollama: { name: 'Ollama', restricted: true, profileId: '9b1b7310-0604-4aaa-8000-000000000005' },
} as const;
const ids = Object.keys(CLI_PROVIDERS) as CliId[];
const unavailableUsage: Usage = { inputTokens: 0, outputTokens: 0, source: 'unavailable' };
function capabilities(streaming: boolean, usage = false): ModelCapabilities {
  return {
    streaming: streaming ? 'supported' : 'unknown',
    tools: 'unsupported',
    reportedUsage: usage ? 'supported' : 'unknown',
    vision: 'unknown',
    jsonSchema: 'unknown',
    nativeComputerUse: 'unsupported',
    checkedAt: new Date().toISOString(),
  };
}
function executionFailure(value: string): Error {
  return new Error(
    /auth|login|log in|unauthorized|401|credential/i.test(value)
      ? 'AUTH_FAILED'
      : /model.*(not found|invalid|unavailable)|model_not_found/i.test(value)
        ? 'CLI_MODEL_INVALID'
        : 'CLI_EXECUTION_FAILED',
  );
}
/** Print mode receives the full conversation via stdin, never a session identifier or prompt argv. */
export function claudeArguments(model: string): string[] {
  return [
    '--restricted',
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--disallowedTools',
    '*',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--settings',
    '{"disableAllHooks":true}',
    ...(model ? ['--model', model] : []),
  ];
}
type ClaudeLine = { text?: string; final?: string; usage?: Usage };
export function parseClaudeLine(line: string): ClaudeLine {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('INVALID_RESPONSE');
  const event = value as Record<string, unknown>;
  if (event.type === 'assistant') {
    const content = (event.message as { content?: { type?: string }[] } | undefined)?.content;
    if (content?.some((item) => item.type === 'tool_use')) throw new Error('CAPABILITY_REQUIRED');
  }
  if (event.type === 'stream_event') {
    const inner = event.event as
      | {
          type?: string;
          content_block?: { type?: string };
          delta?: { type?: string; text?: string };
        }
      | undefined;
    if (inner?.content_block?.type === 'tool_use') throw new Error('CAPABILITY_REQUIRED');
    if (
      inner?.type === 'content_block_delta' &&
      inner.delta?.type === 'text_delta' &&
      typeof inner.delta.text === 'string'
    )
      return { text: inner.delta.text };
  }
  if (event.type === 'result') {
    if (event.is_error === true)
      throw executionFailure(JSON.stringify(event.errors ?? event.result ?? ''));
    if (typeof event.result !== 'string') throw new Error('INVALID_RESPONSE');
    return { final: event.result };
  }
  return {};
}
/** Unsupported adapters are explicit: no fallback to an unrestricted coding agent. */
class UnsupportedCliAdapter {
  async create(): Promise<ModelAdapter> {
    throw new Error('CAPABILITY_REQUIRED');
  }
}
/** Exec JSON emits completed messages, not verified token deltas. Keep streaming unknown. */
export class CodexCliAdapter implements ModelAdapter {
  readonly id = 'cli:codex';
  constructor(
    private readonly runtime: CliRuntime,
    private readonly launcher: Launcher,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly checkHome: () => Promise<void> = assertCodexHome,
  ) {}
  estimateCost() {
    return null;
  }
  async capabilities() {
    return capabilities(false, true);
  }
  async probe(signal: AbortSignal, onUsage?: (usage: Usage) => void) {
    const result = await this.generate(
      { messages: [{ role: 'user', content: 'Reply with ROVDO_OK only.' }], tools: [] },
      signal,
    );
    onUsage?.(result.usage);
    return this.capabilities();
  }
  async generate(
    request: { messages: NormalizedMessage[]; tools: unknown[] },
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<AgentTurn> {
    if (request.tools.length) throw new Error('CLI_ISOLATION_REQUIRED');
    await this.checkHome();
    // Re-check before every inference: an automatic CLI update must not inherit an old safety verdict.
    const version = await this.runtime.run(this.launcher, ['--version'], '', signal, 3000);
    if (version.exitCode !== 0 || version.stdout.trim() !== `codex-cli ${CODEX_ISOLATED_VERSION}`)
      throw new Error('CLI_UNSUPPORTED');
    let pending = '',
      text = '',
      done = false,
      usage: Usage | undefined,
      parserError: unknown;
    const local = new AbortController();
    const abort = () => local.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const consume = (line: string) => {
      if (!line.trim()) return;
      if (done) throw new Error('INVALID_RESPONSE');
      const event = parseCodexLine(line);
      if (event.text !== undefined) text += (text ? '\n\n' : '') + event.text;
      if (event.done) {
        done = true;
        usage = event.usage;
      }
    };
    try {
      const result = await this.runtime
        .run(
          this.launcher,
          codexArguments(this.model),
          JSON.stringify({
            conversation: request.messages.map(({ role, content }) => ({ role, content })),
          }),
          local.signal,
          this.timeoutMs,
          (chunk) => {
            pending += chunk;
            if (Buffer.byteLength(pending) > 256000) {
              parserError = new Error('INVALID_RESPONSE');
              local.abort();
              return;
            }
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            try {
              for (const line of lines) consume(line);
            } catch (error) {
              parserError = error;
              local.abort();
            }
          },
        )
        .catch((error) => {
          throw parserError ?? error;
        });
      if (pending.trim()) consume(pending);
      if (result.exitCode !== 0) throw codexFailure(result.stderr);
      if (!done || !usage || !text.trim()) throw new Error('INVALID_RESPONSE');
      // Release text only after a successful, validated turn; no partial tool/error output reaches the renderer.
      onText?.(text);
      return { text, usage, toolCalls: [], stopReason: 'stop' };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}
export class GeminiCliAdapter extends UnsupportedCliAdapter {}
export class QwenCliAdapter extends UnsupportedCliAdapter {}

class ClaudeCliAdapter implements ModelAdapter {
  readonly id = 'cli:claude';
  private caps = capabilities(false);
  constructor(
    private readonly runtime: CliRuntime,
    private readonly launcher: Launcher,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}
  estimateCost() {
    return null;
  }
  async capabilities() {
    return this.caps;
  }
  async probe(signal: AbortSignal, onUsage?: (usage: Usage) => void) {
    const result = await this.generate(
      { messages: [{ role: 'user', content: 'Reply with ROVDO_OK only.' }], tools: [] },
      signal,
    );
    onUsage?.(result.usage);
    return this.caps;
  }
  async generate(
    request: { messages: NormalizedMessage[]; tools: unknown[] },
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<AgentTurn> {
    let pending = '',
      text = '',
      final: string | undefined,
      seenDelta = false,
      parserError: unknown;
    const local = new AbortController();
    const abort = () => local.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = parseClaudeLine(line);
      if (event.text !== undefined) {
        seenDelta = true;
        text += event.text;
        onText?.(event.text);
      }
      if (event.final !== undefined) final = event.final;
    };
    try {
      // JSON preserves role boundaries and never loads repo context. Built-ins, MCP, skills and hooks are disabled.
      const result = await this.runtime
        .run(
          this.launcher,
          claudeArguments(this.model),
          JSON.stringify({
            conversation: request.messages.map(({ role, content }) => ({ role, content })),
          }),
          local.signal,
          this.timeoutMs,
          (chunk) => {
            pending += chunk;
            if (Buffer.byteLength(pending) > 256000) {
              parserError = new Error('INVALID_RESPONSE');
              local.abort();
              return;
            }
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            try {
              for (const line of lines) consume(line);
            } catch (error) {
              parserError = error;
              local.abort();
            }
          },
        )
        .catch((error) => {
          throw parserError ?? error;
        });
      if (pending.trim()) consume(pending);
      if (result.exitCode !== 0) throw executionFailure(result.stderr);
      if (final === undefined || !final.trim()) throw new Error('INVALID_RESPONSE');
      if (!seenDelta) {
        text = final;
        onText?.(text);
      } else if (text !== final) throw new Error('INVALID_RESPONSE');
      this.caps = capabilities(seenDelta);
      return { text, toolCalls: [], usage: unavailableUsage, stopReason: 'stop' };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}
/** Reuse the existing scoped OpenAI-compatible transport; never launch `ollama run` (which can pull models). */
export class OllamaCliAdapter implements ModelAdapter {
  readonly id = 'cli:ollama';
  private caps = capabilities(false);
  private readonly delegate: ModelAdapter;
  constructor(model: string, timeoutMs: number, fetcher?: typeof fetch) {
    this.delegate = createAdapter(
      {
        id: CLI_PROVIDERS.ollama.profileId,
        label: 'Ollama CLI',
        kind: 'compatible',
        authMode: 'none',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model,
        timeoutMs,
        maxOutputTokens: 1024,
        includeUsage: true,
      },
      '',
      fetcher,
    );
  }
  estimateCost() {
    return null;
  }
  async capabilities() {
    return this.caps;
  }
  async probe(signal: AbortSignal, onUsage?: (usage: Usage) => void) {
    const result = await this.generate(
      { messages: [{ role: 'user', content: 'Reply with ROVDO_OK only.' }], tools: [] },
      signal,
    );
    onUsage?.(result.usage);
    return this.caps;
  }
  async generate(
    request: Parameters<ModelAdapter['generate']>[0],
    signal: AbortSignal,
    onText?: (text: string) => void,
  ) {
    let streamed = false;
    const result = await this.delegate.generate({ ...request, tools: [] }, signal, (text) => {
      streamed = true;
      onText?.(text);
    });
    if (result.toolCalls.length) throw new Error('CAPABILITY_REQUIRED');
    this.caps = capabilities(streamed, result.usage.source === 'reported');
    return result;
  }
}

export class CliService {
  private readonly runtime: CliRuntime;
  private readonly launchers = new Map<CliId, Launcher>();
  private readonly states = new Map<CliId, CliView>();
  private scanned = false;
  private scanning: Promise<CliView[]> | null = null;
  private readonly find: (id: CliId) => Promise<Launcher | null>;
  constructor(
    private readonly store: SettingsStore,
    options: { find?: (id: CliId) => Promise<Launcher | null>; runtime?: CliRuntime } = {},
  ) {
    this.find = options.find ?? findCli;
    this.runtime = options.runtime ?? new CliRuntime();
  }
  views(): CliView[] {
    return ids.map((id) => {
      const pref = this.store.cliPreferences().find((p) => p.id === id);
      const prior = this.states.get(id);
      return {
        id,
        profileId: CLI_PROVIDERS[id].profileId,
        name: CLI_PROVIDERS[id].name,
        version: null,
        status: 'not-installed',
        model: pref?.model ?? '',
        timeoutMs: pref?.timeoutMs ?? 60000,
        revision: 0,
        models: [],
        text: 'unknown',
        streaming: 'unknown',
        ...prior,
      };
    });
  }
  idForProfile(profileId: string): CliId | undefined {
    return ids.find((id) => CLI_PROVIDERS[id].profileId === profileId);
  }
  async scan(force = false): Promise<CliView[]> {
    if (this.scanning) return this.scanning;
    if (this.scanned && !force) return this.views();
    const pending = this.performScan();
    this.scanning = pending;
    try {
      return await pending;
    } finally {
      this.scanning = null;
    }
  }
  private async performScan(): Promise<CliView[]> {
    // Deliberately sequential and settings-only: at most one short probe process, never startup enumeration.
    for (const base of this.views()) {
      const launcher = await this.find(base.id);
      const prior = this.launchers.get(base.id);
      if (!launcher) {
        this.launchers.delete(base.id);
        this.states.set(base.id, {
          ...base,
          version: null,
          status: 'not-installed',
          text: 'unknown',
          streaming: 'unknown',
        });
        continue;
      }
      this.launchers.set(base.id, launcher);
      try {
        const result = await this.runtime.run(
          launcher,
          ['--version'],
          '',
          new AbortController().signal,
          3000,
        );
        const version = result.stdout.match(/\b(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)\b/)?.[1] ?? null;
        let status: CliView['status'] =
          result.exitCode === 0 && version ? 'installed' : 'unsupported-version';
        if (status === 'installed' && !CLI_PROVIDERS[base.id].restricted)
          status = 'unsupported-mode';
        if (base.id === 'claude' && version) {
          const [a, b, c] = version.split('.').map(Number);
          if (a !== 2 || b !== 1 || !c || c < 248) status = 'unsupported-version';
        }
        if (base.id === 'codex' && status === 'installed') {
          if (
            version !== CODEX_ISOLATED_VERSION ||
            result.stdout.trim() !== `codex-cli ${CODEX_ISOLATED_VERSION}`
          )
            status = 'unsupported-version';
          else {
            try {
              await assertCodexHome();
            } catch {
              status = 'unsupported-mode';
            }
          }
        }
        const unchanged =
          JSON.stringify(prior) === JSON.stringify(launcher) && base.version === version;
        this.states.set(base.id, {
          ...base,
          version,
          status:
            unchanged && base.status === 'connected' && status === 'installed'
              ? 'connected'
              : status,
          text: unchanged ? base.text : 'unknown',
          streaming: unchanged ? base.streaming : 'unknown',
        });
        if (base.id === 'ollama' && status === 'installed') await this.ollamaModels(launcher);
      } catch {
        this.states.set(base.id, {
          ...base,
          status: 'unavailable',
          text: 'unknown',
          streaming: 'unknown',
        });
      }
    }
    this.scanned = true;
    return this.views();
  }
  private async ollamaModels(launcher: Launcher) {
    const result = await this.runtime.run(
      launcher,
      ['list'],
      '',
      new AbortController().signal,
      3000,
    );
    if (result.exitCode !== 0) throw new Error('CLI_EXECUTION_FAILED');
    const models = result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((value) => !!value && CliModelSchema.safeParse(value).success)
      .slice(0, 500);
    const base = this.states.get('ollama')!;
    this.states.set('ollama', { ...base, models: [...new Set(models)].sort() });
  }
  save(input: unknown): void {
    const pref = CliPreferenceSchema.parse(input);
    this.store.saveCli(pref);
    const base = this.views().find((v) => v.id === pref.id)!;
    this.states.set(pref.id, {
      ...base,
      ...pref,
      revision: base.revision + 1,
      status: base.status === 'connected' ? 'installed' : base.status,
      text: 'unknown',
      streaming: 'unknown',
    });
  }
  async adapter(id: CliId, timeoutLimit?: number): Promise<ModelAdapter> {
    if (id === 'gemini') return new GeminiCliAdapter().create();
    if (id === 'qwen') return new QwenCliAdapter().create();
    const view = this.views().find((v) => v.id === id)!;
    const launcher = this.launchers.get(id);
    if (!launcher) throw new Error('CLI_NOT_INSTALLED');
    if (view.status === 'unsupported-version' || view.status === 'unsupported-mode')
      throw new Error('CLI_UNSUPPORTED');
    if (id === 'codex')
      return new CodexCliAdapter(
        this.runtime,
        launcher,
        view.model,
        Math.min(view.timeoutMs, timeoutLimit ?? 300000),
      );
    if (id === 'claude')
      return new ClaudeCliAdapter(
        this.runtime,
        launcher,
        view.model || (await claudeConfiguredModel()),
        Math.min(view.timeoutMs, timeoutLimit ?? 300000),
      );
    const model = view.model || view.models[0];
    if (!model || !view.models.includes(model)) throw new Error('CLI_MODEL_INVALID');
    return new OllamaCliAdapter(model, Math.min(view.timeoutMs, timeoutLimit ?? 300000));
  }
  async test(id: CliId, signal: AbortSignal): Promise<void> {
    try {
      const adapter = await this.adapter(id, 20000);
      const caps = await adapter.probe(signal);
      this.states.set(id, {
        ...this.views().find((v) => v.id === id)!,
        status: 'connected',
        revision: this.views().find((v) => v.id === id)!.revision + 1,
        text: 'supported',
        streaming: caps.streaming === 'supported' ? 'supported' : 'unknown',
      });
    } catch (error) {
      const base = this.views().find((v) => v.id === id)!;
      this.states.set(id, {
        ...base,
        status:
          error instanceof Error && error.message === 'AUTH_FAILED'
            ? 'authentication-required'
            : base.status === 'connected'
              ? 'installed'
              : base.status,
        text: 'unknown',
        streaming: 'unknown',
      });
      throw error;
    }
  }
  async shutdown() {
    await this.runtime.shutdown();
  }
}
