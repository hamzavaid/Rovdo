import { createHash, randomUUID } from 'node:crypto';
import { BrowserActionSchema, BrowserRequestSchema } from '@rovdo/shared';
import type { BrowserAction, BrowserRecord, BrowserRequest, Observation, ProviderConfig } from '@rovdo/shared';
import type { RuntimeStore } from '@rovdo/storage';

export class ActionPolicy {
  constructor(private readonly request: BrowserRequest) {}
  authorize(input: unknown): 'ALLOW' | 'APPROVAL' {
    const action = BrowserActionSchema.parse(input);
    if (action.tool === 'navigate') {
      const u = new URL(action.url);
      if (u.protocol !== 'https:' || u.username || u.password || !this.request.allowedOrigins.includes(u.origin)) throw new Error('DESTINATION_BLOCKED');
    }
    return ['fill', 'click', 'select'].includes(action.tool) ? 'APPROVAL' : 'ALLOW';
  }
}
export interface BrowserPort {
  open(url: string): Promise<void>;
  observe(): Promise<Observation>;
  execute(action: BrowserAction): Promise<{ verified: boolean; kind: string }>;
  close(): Promise<void>;
}
export type BrowserPlan = { actions: unknown[]; inputTokens: number; outputTokens: number; usd: number | null };
export type BrowserPlanner = (record: BrowserRecord, observation: Observation, signal: AbortSignal) => Promise<BrowserPlan>;
const terminal = (r: BrowserRecord) => ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELED'].includes(r.state);

export class BrowserRuntime {
  private active: { id: string; worker: BrowserPort; controller: AbortController; request: BrowserRequest; redactions: Set<string>; timer?: ReturnType<typeof setTimeout>; pending?: BrowserAction; token?: string } | null = null;
  private work: Promise<void> | null = null;
  constructor(private readonly store: RuntimeStore, private readonly makeWorker: (request: BrowserRequest) => BrowserPort, private readonly plan: BrowserPlanner) { store.recover(); }
  async start(input: unknown, providerSnapshot: ProviderConfig | null = null): Promise<string> {
    if (this.active) throw new Error('BUSY');
    const request = BrowserRequestSchema.parse(input); const id = randomUUID(); const now = Date.now();
    this.store.save({ id, request, providerSnapshot, createdAt: now, deadline: now + request.maxDurationMs, state: 'CREATED', steps: 0, tokens: 0, spent: 0, lastUrl: request.startUrl, observation: null, approval: null, reason: null });
    this.launch(id); return id;
  }
  private launch(id: string): void {
    const r = this.store.get(id);
    const active: NonNullable<BrowserRuntime['active']> = { id, worker: this.makeWorker(r.request), controller: new AbortController(), request: structuredClone(r.request), redactions: new Set() };
    this.active = active;
    active.timer = setTimeout(() => {
      active.controller.abort();
      const current = this.store.get(id);
      if (!terminal(current)) this.save({ ...current, approval: null }, 'PARTIAL', 'TIMEOUT');
      void active.worker.close().finally(() => { if (this.active === active) this.active = null; });
    }, Math.max(1, r.deadline - Date.now()));
    active.timer.unref(); this.schedule(this.loop(true));
  }
  proposal(): BrowserAction | null { return this.active?.pending ?? null; }
  private schedule(work: Promise<void>): void { this.work = work; void work.catch(() => {}); }
  async settled(): Promise<void> { await this.work; }
  private save(r: BrowserRecord, state: BrowserRecord['state'], reason: string | null = null): void { r.state = state; r.reason = reason; this.store.save(r); }
  private async loop(open: boolean): Promise<void> {
    const active = this.active; if (!active) return;
    let r = this.store.get(active.id);
    try {
      this.save(r, 'PREFLIGHT');
      if (open) await active.worker.open(r.lastUrl);
      while (!active.controller.signal.aborted) {
        r = this.store.get(active.id);
        if (Date.now() >= r.deadline) { this.save(r, 'PARTIAL', 'TIMEOUT'); break; }
        this.save(r, 'VERIFYING');
        const observation = await active.worker.observe();
        if (active.controller.signal.aborted) return;
        for (const value of active.redactions) observation.text = observation.text.replaceAll(value, '[redacted]');
        r.observation = observation; r.lastUrl = observation.url;
        if (observation.challenge) { this.save(r, 'PAUSED', 'HUMAN_CHALLENGE'); break; }
        if (observation.text.includes(r.request.expectedText)) { this.save(r, 'COMPLETED'); this.store.save(r, 'verified', createHash('sha256').update(observation.text).digest('hex')); break; }
        if (r.steps >= r.request.maxSteps || r.tokens >= r.request.maxTokens || r.spent > r.request.maxUsd) { this.save(r, 'PARTIAL', 'BUDGET_EXCEEDED'); break; }
        this.save(r, 'PLANNING');
        const result = await this.plan(r, observation, AbortSignal.any([active.controller.signal, AbortSignal.timeout(Math.max(1, r.deadline - Date.now()))]));
        if (active.controller.signal.aborted) return;
        r.tokens += result.inputTokens + result.outputTokens;
        if (result.usd === null || !Number.isFinite(result.usd) || result.usd < 0) { this.save(r, 'PARTIAL', 'ACCOUNTING_UNAVAILABLE'); break; }
        r.spent += result.usd; this.store.save(r, 'usage');
        if (r.tokens > r.request.maxTokens || r.spent > r.request.maxUsd) { this.save(r, 'PARTIAL', 'BUDGET_EXCEEDED'); break; }
        // One action per observation prevents stale chained proposals and approval laundering.
        if (result.actions.length !== 1) throw new Error('INVALID_PLAN');
        const action = BrowserActionSchema.parse(result.actions[0]);
        const decision = new ActionPolicy(r.request).authorize(action);
        if (decision === 'APPROVAL') {
          active.pending = action;
          const digest = createHash('sha256').update(JSON.stringify({ runId: r.id, action, nonce: randomUUID() })).digest('hex'); active.token = digest;
          r.approval = { digest, summary: `${action.tool}${'target' in action ? `: ${action.target.role} ${action.target.name}` : ''} at ${new URL(r.lastUrl).origin}`, expiresAt: Math.min(r.deadline, Date.now() + 300000) };
          this.save(r, 'AWAITING_APPROVAL'); this.store.save(r, 'approval', r.approval.summary); return;
        }
        await this.execute(action, r);
      }
    } catch {
      if (!active.controller.signal.aborted) { r = this.store.get(active.id); this.save(r, 'FAILED', 'POLICY_OR_EXECUTION_FAILED'); this.store.save(r, 'denied'); }
    } finally {
      r = this.store.get(active.id);
      if (terminal(r) || r.state === 'PAUSED') { clearTimeout(active.timer); await active.worker.close(); if (this.active === active) this.active = null; }
    }
  }
  private async execute(action: BrowserAction, r: BrowserRecord): Promise<void> {
    const active = this.active!;
    if (active.controller.signal.aborted || Date.now() >= r.deadline) throw new Error('CANCELED');
    r.steps++; r.approval = null; this.save(r, 'EXECUTING'); this.store.save(r, 'authorized', action.tool);
    if ('value' in action && action.value) active.redactions.add(action.value);
    let result: { verified: boolean; kind: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { result = await active.worker.execute(action); break; }
      catch { if (attempt || !['snapshot', 'find', 'navigate'].includes(action.tool)) throw new Error('ACTION_AMBIGUOUS'); this.save(r, 'RETRYING'); }
    }
    if (active.controller.signal.aborted) throw new Error('CANCELED');
    if (!result?.verified) throw new Error('POSTCONDITION_FAILED');
    this.save(r, 'VERIFYING'); this.store.save(r, 'verified', `${action.tool}${'target' in action ? `:${action.target.role} ${action.target.name}` : ''}`);
  }
  async approve(id: string, digest: string, allow: boolean): Promise<void> {
    await this.settled();
    const r = this.store.get(id); const a = this.active;
    if (!a || a.id !== id || r.state !== 'AWAITING_APPROVAL' || !a.pending || a.token !== digest || r.approval?.digest !== digest || Date.now() >= r.approval.expiresAt) throw new Error('APPROVAL_INVALID');
    const action = a.pending; delete a.pending; delete a.token; r.approval = null;
    this.store.save(r, 'approval', `${allow ? 'approved' : 'denied'}:${digest}`);
    if (!allow) { clearTimeout(a.timer); this.save(r, 'PAUSED', 'APPROVAL_DENIED'); await a.worker.close(); this.active = null; return; }
    this.schedule((async () => {
      try { new ActionPolicy(r.request).authorize(action); await this.execute(action, r); await this.loop(false); }
      catch { if (!a.controller.signal.aborted) this.save(r, 'PAUSED', 'ACTION_NEEDS_RECONCILIATION'); clearTimeout(a.timer); await a.worker.close(); if (this.active === a) this.active = null; }
    })());
  }
  async pause(id: string): Promise<void> { await this.stop(id, 'PAUSED'); }
  async cancel(id: string): Promise<void> { await this.stop(id, 'CANCELED'); }
  private async stop(id: string, state: 'PAUSED' | 'CANCELED'): Promise<void> {
    const r = this.store.get(id); if (terminal(r)) return;
    if (this.active?.id === id) { const a = this.active; clearTimeout(a.timer); a.controller.abort(); await a.worker.close(); await this.work; this.active = null; }
    this.store.save({ ...this.store.get(id), state, approval: null, reason: state });
  }
  async resume(id: string): Promise<void> { if (this.active || this.store.get(id).state !== 'PAUSED') throw new Error('BUSY'); this.launch(id); }
  async shutdown(): Promise<void> { if (this.active) await this.pause(this.active.id); await this.work; }
}
