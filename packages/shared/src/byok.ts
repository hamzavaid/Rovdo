/**
 * Provider settings, capability, chat, usage and streaming-event contracts.
 * Configuration contains no API-key field; credentials are represented only by status in public views.
 */
import { z } from 'zod';

export const FailureCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'IPC_FORBIDDEN',
  'INTERNAL_ERROR',
  'VAULT_UNAVAILABLE',
  'CREDENTIAL_ENTRY_UNAVAILABLE',
  'KEY_REQUIRED',
  'PROFILE_NOT_FOUND',
  'BUSY',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_RESPONSE',
  'TIMEOUT',
  'CANCELED',
  'DESTINATION_BLOCKED',
  'CAPABILITY_REQUIRED',
  'BUDGET_EXCEEDED',
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;
const flag = z.enum(['supported', 'unsupported', 'unknown']);
export const CapabilitiesSchema = z.strictObject({
  streaming: flag,
  tools: flag,
  reportedUsage: flag,
  vision: flag,
  jsonSchema: flag,
  nativeComputerUse: flag,
  checkedAt: z.iso.datetime(),
});
export type ModelCapabilities = z.infer<typeof CapabilitiesSchema>;
export const PricingSchema = z.strictObject({
  inputPerMillion: z.number().finite().nonnegative().max(100_000),
  outputPerMillion: z.number().finite().nonnegative().max(100_000),
  cachedInputPerMillion: z.number().finite().nonnegative().max(100_000).optional(),
  version: z.string().trim().min(1).max(80),
});

export function isProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || /%|\\/.test(value)) return false;
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]')
      return /^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.includes('.') &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      !url.hostname.includes(':') &&
      !/\.(local|internal|localhost|lan|home)$/.test(url.hostname) &&
      url.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
    );
  } catch {
    return false;
  }
}

export const ProviderConfigSchema = z
  .strictObject({
    id: z.uuid(),
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['openai', 'anthropic', 'compatible']),
    authMode: z.enum(['api-key', 'none']).optional(),
    baseUrl: z.string().max(2048).refine(isProviderUrl),
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9._:/-]+$/),
    timeoutMs: z.number().int().min(1000).max(300_000),
    maxOutputTokens: z.number().int().min(32).max(32_768),
    temperature: z.number().min(0).max(1).optional(),
    includeUsage: z.boolean(),
    proxyUrl: z
      .string()
      .max(2048)
      .refine(
        (value) =>
          isProviderUrl(value) && value.startsWith('https://') && new URL(value).pathname === '/',
      )
      .optional(),
    pricing: PricingSchema.optional(),
    capabilities: CapabilitiesSchema.optional(),
  })
  .refine(
    (profile) =>
      profile.kind === 'compatible' ||
      (profile.authMode !== 'none' &&
        profile.baseUrl ===
          (profile.kind === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com')),
    { message: 'Hosted providers require their official endpoint and authentication' },
  );
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export const ProfileIdSchema = z.strictObject({ profileId: z.uuid() });
export const RequestIdSchema = z.strictObject({ requestId: z.uuid() });
export const ChatRequestSchema = z.strictObject({
  requestId: z.uuid(),
  profileId: z.uuid(),
  text: z.string().trim().min(1).max(32_000),
  consent: z.literal(true),
  maxUsd: z.number().finite().positive().max(100),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export const ProbeRequestSchema = z.strictObject({ profileId: z.uuid(), consent: z.literal(true) });

export const UsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  source: z.enum(['reported', 'unavailable']),
});
export type Usage = z.infer<typeof UsageSchema>;
export type CostEstimate = { usd: number; pricingVersion: string };
export const UsageRecordSchema = z.strictObject({
  requestId: z.uuid(),
  profileId: z.uuid(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  source: z.enum(['reported', 'unavailable']),
  estimatedUsd: z.number().finite().nonnegative().nullable(),
  pricingVersion: z.string().max(80).nullable(),
  status: z.enum(['completed', 'failed', 'canceled']),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
export const UsageSummarySchema = z.strictObject({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
  requests: z.number().int().nonnegative(),
  unpricedRequests: z.number().int().nonnegative(),
});
export const ProfileViewSchema = z.strictObject({
  config: ProviderConfigSchema,
  credential: z.enum(['stored', 'missing', 'unavailable', 'not-required']),
});
export const SettingsViewSchema = z.strictObject({
  profiles: z.array(ProfileViewSchema),
  usage: UsageSummarySchema,
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

export const ChatEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), requestId: z.uuid(), text: z.string().max(1_000_000) }),
  z.strictObject({
    type: z.literal('tool'),
    requestId: z.uuid(),
    name: z.literal('workspace_info'),
  }),
  z.strictObject({
    type: z.literal('usage'),
    requestId: z.uuid(),
    usage: UsageSchema,
    estimatedUsd: z.number().nonnegative().nullable(),
    pricingVersion: z.string().max(80).nullable(),
  }),
  z.strictObject({
    type: z.literal('done'),
    requestId: z.uuid(),
    status: z.enum(['completed', 'canceled', 'failed']),
    code: FailureCodeSchema.optional(),
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;
export const ResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    code: FailureCodeSchema,
    retryAfterMs: z.number().nonnegative().optional(),
  }),
]);
export type Result = z.infer<typeof ResultSchema>;
export const SettingsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), settings: SettingsViewSchema }),
  z.strictObject({ ok: z.literal(false), code: FailureCodeSchema }),
]);

export const BYOK_CHANNELS = Object.freeze({
  settings: 'models:list',
  save: 'models:save',
  remove: 'models:remove',
  enterKey: 'models:enter-key',
  removeKey: 'models:remove-key',
  probe: 'models:probe',
  chat: 'chat:start',
  cancel: 'chat:cancel',
  clear: 'chat:clear',
  event: 'chat:event',
});
export interface ByokApi {
  getSettings(): Promise<z.infer<typeof SettingsResultSchema>>;
  saveProfile(config: ProviderConfig): Promise<Result>;
  removeProfile(input: { profileId: string }): Promise<Result>;
  enterKey(input: { profileId: string }): Promise<Result>;
  removeKey(input: { profileId: string }): Promise<Result>;
  testConnection(input: { profileId: string; consent: true }): Promise<Result>;
  startChat(input: ChatRequest): Promise<Result>;
  cancelChat(input: { requestId: string }): Promise<Result>;
  clearChat(): Promise<Result>;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
}

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; additionalProperties: false };
};
export type NormalizedMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};
export type AgentTurnRequest = {
  messages: NormalizedMessage[];
  tools: ToolDefinition[];
  toolChoice?: 'auto' | 'required';
  maxOutputTokens?: number;
};
export type AgentTurn = {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: 'stop' | 'tools' | 'length';
};
