import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { ProviderConfigSchema, UsageSchema } from '@rovdo/shared';
import type { AgentTurn, AgentTurnRequest, CostEstimate, ModelCapabilities, ProviderConfig, ToolCall, Usage } from '@rovdo/shared';
import { createSafeFetch } from './network';
import { normalizeError, ProviderError } from './errors';
export { ProviderError } from './errors';
export { validateDestination } from './network';

export const WORKSPACE_TOOL = { name: 'workspace_info', description: 'Read the Rovdo application version and enabled capabilities. No personal data.', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false as const } };
export interface ModelAdapter {
  readonly id: string;
  generate(request: AgentTurnRequest, signal: AbortSignal, onText?: (text: string) => void): Promise<AgentTurn>;
  probe(signal: AbortSignal, onUsage?: (usage: Usage) => void): Promise<ModelCapabilities>;
  capabilities(modelId: string): Promise<ModelCapabilities>;
  estimateCost(usage: Usage): CostEstimate | null;
}

function unknownCapabilities(): ModelCapabilities {
  return { streaming: 'unknown', tools: 'unknown', reportedUsage: 'unknown', vision: 'unknown', jsonSchema: 'unknown', nativeComputerUse: 'unknown', checkedAt: new Date().toISOString() };
}

class SecretStream {
  private pending = '';
  constructor(private readonly secret: string) {}
  push(value: string, flush = false): string {
    this.pending += value;
    let result = '';
    while (this.pending.length && (flush || this.pending.length >= this.secret.length)) {
      if (this.secret && this.pending.startsWith(this.secret)) { result += '[redacted]'; this.pending = this.pending.slice(this.secret.length); }
      else { result += this.pending[0]; this.pending = this.pending.slice(1); }
    }
    return result;
  }
}

export class ProviderRegistry {
  private readonly factories = new Map<ProviderConfig['kind'], (config: ProviderConfig, key: string, fetcher?: typeof fetch) => ModelAdapter>();
  register(kind: ProviderConfig['kind'], factory: (config: ProviderConfig, key: string, fetcher?: typeof fetch) => ModelAdapter): void { this.factories.set(kind, factory); }
  create(config: ProviderConfig, key: string, fetcher?: typeof fetch): ModelAdapter {
    const factory = this.factories.get(config.kind);
    if (!factory) throw new ProviderError('CAPABILITY_REQUIRED');
    return factory(config, key, fetcher);
  }
}

export function createAdapter(input: ProviderConfig, key: string, injectedFetch?: typeof fetch): ModelAdapter {
  const parsed = ProviderConfigSchema.safeParse(input);
  if (!parsed.success || (!key && parsed.data.authMode !== 'none')) throw new ProviderError('VALIDATION_ERROR');
  const config = parsed.data;
  const transport = injectedFetch ?? createSafeFetch(config.baseUrl, config.proxyUrl);
  const fetcher: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    // Ignore SDK ambient custom headers, cookies and unrelated credentials.
    for (const name of [...request.headers.keys()]) request.headers.delete(name);
    request.headers.set('content-type', 'application/json');
    request.headers.set('accept', 'text/event-stream');
    request.headers.set('accept-encoding', 'identity');
    request.headers.set('user-agent', 'Rovdo/0.1.0');
    if (config.kind === 'anthropic') { request.headers.set('x-api-key', key); request.headers.set('anthropic-version', '2023-06-01'); }
    else if (config.authMode !== 'none') request.headers.set('authorization', `Bearer ${key}`);
    return transport(request);
  };
  const common = { apiKey: key || 'unused', baseURL: config.baseUrl, timeout: config.timeoutMs, maxRetries: 0, fetch: fetcher, logLevel: 'off' as const };
  const openai = config.kind !== 'anthropic' ? new OpenAI({ ...common, organization: null, project: null, adminAPIKey: null, webhookSecret: null }) : null;
  const anthropic = config.kind === 'anthropic' ? new Anthropic({ ...common, authToken: null, openTelemetry: false, webhookKey: null }) : null;

  const adapter: ModelAdapter = {
    id: config.kind,
    async capabilities(modelId) { return modelId === config.model ? config.capabilities ?? unknownCapabilities() : unknownCapabilities(); },
    estimateCost(usage) {
      const pricing = config.pricing;
      // Cache writes have provider-specific prices; never fabricate a total.
      if (!pricing || usage.source !== 'reported' || (usage.cacheWriteTokens ?? 0) > 0 || ((usage.cachedInputTokens ?? 0) > 0 && pricing.cachedInputPerMillion === undefined)) return null;
      const cached = usage.cachedInputTokens ?? 0;
      return { usd: ((usage.inputTokens - cached) * pricing.inputPerMillion + cached * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion) + usage.outputTokens * pricing.outputPerMillion) / 1_000_000, pricingVersion: pricing.version };
    },
    async probe(signal, onUsage) {
      const result = await adapter.generate({ messages: [{ role: 'user', content: 'Call workspace_info once with no arguments to verify this connection.' }], tools: [WORKSPACE_TOOL], toolChoice: 'required', maxOutputTokens: Math.min(128, config.maxOutputTokens) }, signal);
      const tools = result.toolCalls.length === 1 && result.toolCalls[0]!.name === 'workspace_info' && Object.keys(result.toolCalls[0]!.arguments).length === 0;
      onUsage?.(result.usage);
      return { ...unknownCapabilities(), streaming: 'supported', tools: tools ? 'supported' : 'unsupported', reportedUsage: result.usage.source === 'reported' ? 'supported' : 'unknown' };
    },
    async generate(request, signal, onText = () => {}) {
      if (signal.aborted) throw new ProviderError('CANCELED');
      if (key && JSON.stringify(request).includes(key)) throw new ProviderError('VALIDATION_ERROR');
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const combined = AbortSignal.any([signal, timeout]);
      const redactor = new SecretStream(key);
      let text = '';
      let total = 0;
      let usage: Usage = { inputTokens: 0, outputTokens: 0, source: 'unavailable' };
      let stopReason: AgentTurn['stopReason'] | undefined;
      const calls = new Map<number, { id: string; name: string; json: string }>();
      const append = (value: string) => {
        total += value.length;
        if (total > 1_000_000) throw new ProviderError('INVALID_RESPONSE');
        const safe = redactor.push(value); text += safe; if (safe) onText(safe);
      };
      try {
        const max = request.maxOutputTokens ?? config.maxOutputTokens;
        if (anthropic) {
          const messages: MessageParam[] = request.messages.map((message) => {
            if (message.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId!, content: message.content }] };
            const content: ContentBlockParam[] = [];
            if (message.content) content.push({ type: 'text', text: message.content });
            for (const call of message.toolCalls ?? []) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
            return { role: message.role, content };
          });
          const stream = await anthropic.messages.create({ model: config.model, max_tokens: max, stream: true, messages,
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
            ...(request.tools.length ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })), tool_choice: { type: request.toolChoice === 'required' ? 'any' as const : 'auto' as const } } : {}),
          }, { signal: combined });
          for await (const event of stream) {
            if (combined.aborted) throw new ProviderError('CANCELED');
            if (event.type === 'message_start') {
              const cached = event.message.usage.cache_read_input_tokens ?? 0;
              usage = { inputTokens: event.message.usage.input_tokens + cached, outputTokens: event.message.usage.output_tokens, cachedInputTokens: cached, cacheWriteTokens: event.message.usage.cache_creation_input_tokens ?? 0, source: 'reported' };
            }
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') append(event.content_block.text);
              if (event.content_block.type === 'tool_use') calls.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' });
            }
            if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') append(event.delta.text);
              if (event.delta.type === 'input_json_delta') {
                const call = calls.get(event.index); if (!call) throw new ProviderError('INVALID_RESPONSE');
                call.json += event.delta.partial_json;
                if (call.json.length > 64_000 || calls.size > 8) throw new ProviderError('INVALID_RESPONSE');
              }
            }
            if (event.type === 'message_delta') {
              usage.outputTokens = event.usage.output_tokens;
              if (event.delta.stop_reason) stopReason = event.delta.stop_reason === 'tool_use' ? 'tools' : event.delta.stop_reason === 'max_tokens' ? 'length' : 'stop';
            }
          }
        } else if (openai) {
          const messages: ChatCompletionMessageParam[] = request.messages.map((message) => {
            if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId!, content: message.content };
            if (message.role === 'user') return { role: 'user', content: message.content };
            return { role: 'assistant', content: message.content || null, ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) };
          });
          const stream = await openai.chat.completions.create({ model: config.model, messages, stream: true,
            ...(config.kind === 'openai' ? { max_completion_tokens: max, store: false } : { max_tokens: max }),
            ...(config.includeUsage ? { stream_options: { include_usage: true } } : {}),
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
            ...(request.tools.length ? { tools: request.tools.map((tool) => ({ type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), tool_choice: request.toolChoice ?? 'auto' } : {}),
          }, { signal: combined });
          for await (const chunk of stream) {
            if (combined.aborted) throw new ProviderError('CANCELED');
            if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens, cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0, source: 'reported' };
            const choice = chunk.choices[0]; if (!choice) continue;
            if (choice.delta.content) append(choice.delta.content);
            for (const delta of choice.delta.tool_calls ?? []) {
              const call = calls.get(delta.index) ?? { id: '', name: '', json: '' };
              call.id += delta.id ?? ''; call.name += delta.function?.name ?? ''; call.json += delta.function?.arguments ?? '';
              calls.set(delta.index, call);
              if (call.json.length > 64_000 || calls.size > 8) throw new ProviderError('INVALID_RESPONSE');
            }
            if (choice.finish_reason) stopReason = choice.finish_reason === 'tool_calls' ? 'tools' : choice.finish_reason === 'length' ? 'length' : 'stop';
          }
        }
        if (!stopReason || calls.size > 8) throw new ProviderError('INVALID_RESPONSE');
        const toolCalls: ToolCall[] = [];
        const ids = new Set<string>();
        for (const call of calls.values()) {
          if (!/^[a-zA-Z0-9_-]{1,200}$/.test(call.id) || ids.has(call.id) || !request.tools.some((tool) => tool.name === call.name) || call.json.length > 64_000) throw new ProviderError('INVALID_RESPONSE');
          const args: unknown = JSON.parse(call.json || '{}');
          if (!args || typeof args !== 'object' || Array.isArray(args) || (key && JSON.stringify(args).includes(key))) throw new ProviderError('INVALID_RESPONSE');
          ids.add(call.id); toolCalls.push({ id: call.id, name: call.name, arguments: args as Record<string, unknown> });
        }
        if ((stopReason === 'tools') !== (toolCalls.length > 0)) throw new ProviderError('INVALID_RESPONSE');
        const tail = redactor.push('', true); text += tail; if (tail) onText(tail);
        usage = UsageSchema.parse(usage);
        if ((usage.cachedInputTokens ?? 0) > usage.inputTokens) throw new ProviderError('INVALID_RESPONSE');
        return { text, toolCalls, usage, stopReason };
      } catch (error) {
        if (timeout.aborted && !signal.aborted) throw new ProviderError('TIMEOUT');
        if (error instanceof SyntaxError) throw new ProviderError('INVALID_RESPONSE');
        throw normalizeError(error, signal);
      }
    },
  };
  return adapter;
}
