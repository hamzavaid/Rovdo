import { randomUUID } from 'node:crypto';
import { ChatRequestSchema, EmptyRequestSchema, FailureCodeSchema, ProviderConfigSchema } from '@rovdo/shared';
import type { ChatEvent, ModelCapabilities, NormalizedMessage, ProviderConfig, SettingsView } from '@rovdo/shared';
import { createAdapter, ProviderError, WORKSPACE_TOOL } from '@rovdo/providers';
import type { ModelAdapter } from '@rovdo/providers';
import type { SettingsStore } from '@rovdo/storage';
import type { CredentialVault } from './vault';

type Vault = Pick<CredentialVault, 'get' | 'has' | 'enter' | 'remove'>;
export function failureCode(error: unknown) {
  const parsed = FailureCodeSchema.safeParse(error instanceof ProviderError ? error.code : error instanceof Error ? error.message : 'INTERNAL_ERROR');
  return parsed.success ? parsed.data : 'INTERNAL_ERROR';
}
function sameDestination(a: ProviderConfig, b: ProviderConfig): boolean { return a.kind === b.kind && a.baseUrl === b.baseUrl; }
function sameProbe(a: ProviderConfig, b: ProviderConfig): boolean {
  return sameDestination(a, b) && a.authMode === b.authMode && a.model === b.model && a.includeUsage === b.includeUsage && a.temperature === b.temperature && a.proxyUrl === b.proxyUrl;
}

export class ByokService {
  private active: { id: string; controller: AbortController } | null = null;
  private changing = false;
  private pendingRun: Promise<void> | null = null;
  private readonly history = new Map<string, NormalizedMessage[]>();
  private readonly seen = new Set<string>();
  private readonly cooldown = new Map<string, number>();
  private checkCooldown(id: string): void {
    const remaining = (this.cooldown.get(id) ?? 0) - Date.now();
    if (remaining > 0) throw new ProviderError('RATE_LIMITED', remaining);
  }
  private noteFailure(id: string, error: unknown): void {
    if (error instanceof ProviderError && error.code === 'RATE_LIMITED') this.cooldown.set(id, Date.now() + (error.retryAfterMs ?? 1000));
  }
  constructor(
    private readonly store: SettingsStore,
    private readonly vault: Vault,
    private readonly makeAdapter: (config: ProviderConfig, key: string) => ModelAdapter = createAdapter,
    private readonly version = '0.1.0',
  ) {}
  private assertIdle(): void { if (this.active || this.changing) throw new Error('BUSY'); }
  private async change<T>(work: () => Promise<T>): Promise<T> {
    this.assertIdle(); this.changing = true;
    try { return await work(); } finally { this.changing = false; }
  }
  async list(): Promise<SettingsView> {
    const profiles = await Promise.all(this.store.list().map(async (config) => {
      if (config.authMode === 'none') return { config, credential: 'not-required' as const };
      try { return { config, credential: await this.vault.has(config) ? 'stored' as const : 'missing' as const }; }
      catch { return { config, credential: 'unavailable' as const }; }
    }));
    return { profiles, usage: this.store.usage() };
  }
  async save(input: unknown): Promise<void> {
    const parsed = ProviderConfigSchema.safeParse(input);
    if (!parsed.success || parsed.data.capabilities) throw new Error('VALIDATION_ERROR');
    await this.change(async () => {
      const config = parsed.data;
      const previous = this.store.list().find((item) => item.id === config.id);
      if (!previous && this.store.list().length >= 20) throw new Error('VALIDATION_ERROR');
      if (previous && previous.authMode !== 'none' && (!sameDestination(previous, config) || config.authMode === 'none')) await this.vault.remove(previous);
      this.store.save(previous?.capabilities && sameProbe(previous, config) ? { ...config, capabilities: previous.capabilities } : config);
      this.history.delete(config.id);
    });
  }
  async remove(id: string): Promise<void> {
    await this.change(async () => { const profile = this.store.get(id); if (profile.authMode !== 'none') await this.vault.remove(profile); this.store.remove(id); this.history.delete(id); });
  }
  async enterKey(id: string): Promise<void> {
    await this.change(async () => {
      const profile = this.store.get(id);
      if (profile.authMode === 'none') throw new Error('VALIDATION_ERROR');
      if (await this.vault.enter(profile)) { const { capabilities: _capabilities, ...draft } = profile; void _capabilities; this.store.save(draft); this.history.delete(id); }
    });
  }
  async removeKey(id: string): Promise<void> {
    await this.change(async () => {
      const { capabilities: _capabilities, ...profile } = this.store.get(id); void _capabilities;
      if (profile.authMode === 'none') throw new Error('VALIDATION_ERROR');
      await this.vault.remove(profile); this.store.save(profile); this.history.delete(id);
    });
  }
  async probe(id: string, consent: boolean): Promise<void> {
    if (consent !== true) throw new Error('VALIDATION_ERROR');
    await this.change(async () => {
      const profile = this.store.get(id);
      this.checkCooldown(id);
      const key = profile.authMode === 'none' ? '' : await this.vault.get(profile);
      if (!key && profile.authMode !== 'none') throw new Error('KEY_REQUIRED');
      const adapter = this.makeAdapter(profile, key ?? '');
      let accounted = false;
      try {
        const capabilities: ModelCapabilities = await adapter.probe(new AbortController().signal, (usage) => {
          const cost = adapter.estimateCost(usage);
          this.store.recordUsage({ requestId: randomUUID(), profileId: id, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, source: usage.source, estimatedUsd: cost?.usd ?? null, pricingVersion: cost?.pricingVersion ?? null, status: 'completed' });
          accounted = true;
        });
        this.store.save({ ...profile, capabilities });
        if (capabilities.tools !== 'supported') throw new Error('CAPABILITY_REQUIRED');
      } catch (error) { this.noteFailure(id, error); throw error; } finally {
        if (!accounted) this.store.recordUsage({ requestId: randomUUID(), profileId: id, inputTokens: 0, outputTokens: 0, source: 'unavailable', estimatedUsd: null, pricingVersion: null, status: 'failed' });
      }
    });
  }
  clear(): void { this.assertIdle(); this.history.clear(); }
  reset(): void { this.cancel(); this.history.clear(); }
  cancel(id?: string): void { if (this.active && (!id || this.active.id === id)) this.active.controller.abort(); }
  async shutdown(): Promise<void> { this.reset(); await this.pendingRun?.catch(() => {}); }
  run(input: unknown, emit: (event: ChatEvent) => void): Promise<void> {
    if (this.pendingRun) return Promise.reject(new Error('BUSY'));
    const pending = this.execute(input, emit);
    this.pendingRun = pending;
    void pending.finally(() => { if (this.pendingRun === pending) this.pendingRun = null; }).catch(() => {});
    return pending;
  }
  private async execute(input: unknown, emit: (event: ChatEvent) => void): Promise<void> {
    const request = ChatRequestSchema.safeParse(input);
    if (!request.success) throw new Error('VALIDATION_ERROR');
    const { requestId, profileId, text, maxUsd } = request.data;
    this.assertIdle();
    if (this.seen.has(requestId)) throw new Error('VALIDATION_ERROR');
    this.seen.add(requestId); if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
    const controller = new AbortController(); this.active = { id: requestId, controller };
    try {
      const profile = this.store.get(profileId);
      this.checkCooldown(profileId);
      if (profile.capabilities?.streaming !== 'supported' || profile.capabilities.tools !== 'supported') throw new Error('CAPABILITY_REQUIRED');
      if (!profile.pricing) throw new Error('BUDGET_EXCEEDED');
      const messages = [...(this.history.get(profileId) ?? []), { role: 'user' as const, content: text }];
      if (Buffer.byteLength(JSON.stringify(messages)) > 128_000) throw new Error('VALIDATION_ERROR');
      let spent = 0;
      for (let round = 0; round < 3; round++) {
        if (controller.signal.aborted) throw new Error('CANCELED');
        const upperInput = Buffer.byteLength(JSON.stringify({ messages, tools: [WORKSPACE_TOOL] })) + 2048;
        const estimate = (upperInput * Math.max(profile.pricing.inputPerMillion, profile.pricing.cachedInputPerMillion ?? 0) + profile.maxOutputTokens * profile.pricing.outputPerMillion) / 1_000_000;
        if (spent + estimate > maxUsd) throw new Error('BUDGET_EXCEEDED');
        const key = profile.authMode === 'none' ? '' : await this.vault.get(profile); // Retrieve afresh for each request, never from renderer or SQLite.
        if (!key && profile.authMode !== 'none') throw new Error('KEY_REQUIRED');
        if (controller.signal.aborted) throw new Error('CANCELED');
        const adapter = this.makeAdapter(profile, key ?? '');
        let accounted = false;
        try {
          const turn = await adapter.generate({ messages, tools: [WORKSPACE_TOOL] }, controller.signal, (delta) => emit({ type: 'text', requestId, text: delta }));
          const cost = adapter.estimateCost(turn.usage);
          this.store.recordUsage({ requestId, profileId, inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, source: turn.usage.source, estimatedUsd: cost?.usd ?? null, pricingVersion: cost?.pricingVersion ?? null, status: 'completed' });
          accounted = true;
          emit({ type: 'usage', requestId, usage: turn.usage, estimatedUsd: cost?.usd ?? null, pricingVersion: cost?.pricingVersion ?? null });
          spent += cost?.usd ?? 0;
          if (spent > maxUsd) throw new Error('BUDGET_EXCEEDED');
          if (controller.signal.aborted) throw new Error('CANCELED');
          messages.push({ role: 'assistant', content: turn.text, ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}) });
          if (!turn.toolCalls.length) {
            if (turn.stopReason === 'length') throw new Error('INVALID_RESPONSE');
            this.history.set(profileId, messages);
            emit({ type: 'done', requestId, status: 'completed' }); return;
          }
          if (!cost) throw new Error('BUDGET_EXCEEDED'); // Missing accounting never permits another billed request.
          for (const tool of turn.toolCalls) {
            if (tool.name !== WORKSPACE_TOOL.name || !EmptyRequestSchema.safeParse(tool.arguments).success) throw new Error('INVALID_RESPONSE');
            emit({ type: 'tool', requestId, name: 'workspace_info' });
            messages.push({ role: 'tool', toolCallId: tool.id, content: JSON.stringify({ name: 'Rovdo', version: this.version, capabilities: ['chat', 'workspace_info'] }) });
          }
        } finally {
          if (!accounted) this.store.recordUsage({ requestId, profileId, inputTokens: 0, outputTokens: 0, source: 'unavailable', estimatedUsd: null, pricingVersion: null, status: controller.signal.aborted ? 'canceled' : 'failed' });
        }
      }
      throw new Error('BUDGET_EXCEEDED');
    } catch (error) {
      this.noteFailure(profileId, error);
      const code = controller.signal.aborted ? 'CANCELED' : failureCode(error);
      emit({ type: 'done', requestId, status: code === 'CANCELED' ? 'canceled' : 'failed', code });
    } finally { if (this.active?.id === requestId) this.active = null; }
  }
}
