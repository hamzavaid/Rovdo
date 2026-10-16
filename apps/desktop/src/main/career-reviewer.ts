import { createHash, randomUUID } from 'node:crypto';
import { createAdapter } from '@rovdo/providers';
import { evaluateEligibility, reviewPayload } from '@rovdo/career';
import type { CareerStore, SettingsStore } from '@rovdo/storage';
import type { CredentialVault } from './vault';

type ReviewRequest = { jobIds: string[]; modelProfileId: string; maxUsd: number; consent: true };
export async function reviewShortlist(request: ReviewRequest, store: CareerStore, settings: SettingsStore, vault: Pick<CredentialVault, 'get'>, signal: AbortSignal, makeAdapter: typeof createAdapter = createAdapter): Promise<void> {
  const profile = store.profile();
  if (!profile || request.consent !== true || request.jobIds.length > 5 || !request.jobIds.length || new Set(request.jobIds).size !== request.jobIds.length) throw new Error('VALIDATION_ERROR');
  const saved = new Set(store.savedIds());
  const jobs = request.jobIds.map((id) => { if (!saved.has(id)) throw new Error('NOT_SHORTLISTED'); const job = store.job(id); if (evaluateEligibility(job, profile).some((c) => c.result === 'FAIL')) throw new Error('HARD_EXCLUDED'); return job; });
  const config = settings.get(request.modelProfileId); if (!config.pricing) throw new Error('PRICING_REQUIRED');
  let spent = 0;
  for (const job of jobs) {
    const cacheKey = createHash('sha256').update(JSON.stringify([job.id, job.contentSha256, profile.version, 'review-v1', 'deterministic-v1', config.id, config.kind, config.baseUrl, config.model, config.temperature])).digest('hex');
    if (store.review(cacheKey)) continue;
    const content = JSON.stringify(reviewPayload(profile, [job]));
    const upperInput = Buffer.byteLength(content) + 2048;
    const estimate = (upperInput * Math.max(config.pricing.inputPerMillion, config.pricing.cachedInputPerMillion ?? 0) + config.maxOutputTokens * config.pricing.outputPerMillion) / 1000000;
    if (spent + estimate > request.maxUsd || signal.aborted) throw new Error('BUDGET_EXCEEDED');
    const key = config.authMode === 'none' ? '' : await vault.get(config); if (key === null) throw new Error('KEY_REQUIRED');
    const adapter = makeAdapter(config, key); let accounted = false;
    try {
      const turn = await adapter.generate({ messages: [{ role: 'user', content }], tools: [] }, signal);
      const cost = adapter.estimateCost(turn.usage);
      settings.recordUsage({ requestId: randomUUID(), profileId: config.id, inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, source: turn.usage.source, estimatedUsd: cost?.usd ?? null, pricingVersion: cost?.pricingVersion ?? null, status: 'completed' }); accounted = true;
      if (turn.toolCalls.length || turn.stopReason !== 'stop' || turn.text.length > 16000) throw new Error('INVALID_RESPONSE');
      // Notes cannot change source facts, hard gates, score or saved state.
      store.saveReview(cacheKey, { jobId: job.id, contentHash: job.contentSha256, profileVersion: profile.version, model: config.model, text: turn.text, estimatedUsd: cost?.usd ?? null, createdAt: Date.now() });
      if (!cost) throw new Error('ACCOUNTING_UNAVAILABLE');
      spent += cost.usd; if (spent > request.maxUsd) throw new Error('BUDGET_EXCEEDED');
    } finally { if (!accounted) settings.recordUsage({ requestId: randomUUID(), profileId: config.id, inputTokens: 0, outputTokens: 0, source: 'unavailable', estimatedUsd: null, pricingVersion: null, status: signal.aborted ? 'canceled' : 'failed' }); }
  }
}
