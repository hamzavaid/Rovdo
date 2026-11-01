/**
 * Optional, consented AI commentary on saved opportunities.
 * Uses bounded candidate/job projections and records usage; advisory output cannot change deterministic matching.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createAdapter } from '@rovdo/providers';
import { reviewPayload, reviewRequestHash, fingerprint } from '@rovdo/career';
import type { CareerStore, SettingsStore } from '@rovdo/storage';
import type { CredentialVault } from './vault';

type ReviewRequest = {
  jobIds: string[];
  modelProfileId: string;
  maxUsd: number;
  consent: true;
  rankingId?: string | undefined;
  asOf?: string | undefined;
  payloadHash?: string | undefined;
  query?: string | undefined;
};
export async function reviewShortlist(
  request: ReviewRequest,
  store: CareerStore,
  settings: SettingsStore,
  vault: Pick<CredentialVault, 'get'>,
  signal: AbortSignal,
  makeAdapter: typeof createAdapter = createAdapter,
): Promise<void> {
  const profile = store.profile();
  if (
    !profile ||
    request.consent !== true ||
    request.jobIds.length > 5 ||
    !request.jobIds.length ||
    new Set(request.jobIds).size !== request.jobIds.length
  )
    throw new Error('VALIDATION_ERROR');
  const saved = new Set(store.savedIds());
  const jobs = request.jobIds.map((id) => {
    const job = store.job(id);
    if (!saved.has(job.id)) throw new Error('NOT_SHORTLISTED');
    return job;
  });
  const ranking = store
    .rankings()
    .find((r) => r.id === (request.rankingId ?? store.defaultRanking()));
  const asOf = request.asOf ?? new Date().toISOString().slice(0, 10);
  if (
    !ranking ||
    asOf !== new Date().toISOString().slice(0, 10) ||
    new Set(jobs.map((j) => j.id)).size !== jobs.length
  )
    throw new Error('REVIEW_STALE');
  const retrieval = Object.fromEntries(
    jobs.map((job) => [job.id, store.reviewRetrieval(job.id, request.query ?? '')]),
  );
  const payload = reviewPayload(profile, jobs, { ranking, asOf, retrieval });
  if (payload.jobs.some((j) => j.eligibility === 'FAIL')) throw new Error('HARD_EXCLUDED');
  const config = settings.get(request.modelProfileId);
  if (!request.payloadHash || request.payloadHash !== (await reviewRequestHash(payload, config)))
    throw new Error('REVIEW_STALE');

  if (!config.pricing) throw new Error('PRICING_REQUIRED');
  let spent = 0;
  for (const job of jobs) {
    const part = reviewPayload(profile, [job], { ranking, asOf, retrieval });
    const cacheKey = createHash('sha256')
      .update(await reviewRequestHash(part, config))
      .digest('hex');
    if (store.review(cacheKey)) continue;
    const content = JSON.stringify(part);
    if (Buffer.byteLength(content) > 128000) throw new Error('REVIEW_PAYLOAD_LIMIT');
    const upperInput = Buffer.byteLength(content) + 2048;
    const estimate =
      (upperInput *
        Math.max(config.pricing.inputPerMillion, config.pricing.cachedInputPerMillion ?? 0) +
        config.maxOutputTokens * config.pricing.outputPerMillion) /
      1000000;
    if (spent + estimate > request.maxUsd || signal.aborted) throw new Error('BUDGET_EXCEEDED');
    const key = config.authMode === 'none' ? '' : await vault.get(config);
    if (key === null) throw new Error('KEY_REQUIRED');
    const adapter = makeAdapter(config, key);
    let accounted = false;
    try {
      const turn = await adapter.generate(
        { messages: [{ role: 'user', content }], tools: [] },
        signal,
      );
      const cost = adapter.estimateCost(turn.usage);
      settings.recordUsage({
        requestId: randomUUID(),
        profileId: config.id,
        inputTokens: turn.usage.inputTokens,
        outputTokens: turn.usage.outputTokens,
        source: turn.usage.source,
        estimatedUsd: cost?.usd ?? null,
        pricingVersion: cost?.pricingVersion ?? null,
        status: 'completed',
      });
      accounted = true;
      if (turn.toolCalls.length || turn.stopReason !== 'stop' || turn.text.length > 16000)
        throw new Error('INVALID_RESPONSE');
      // Notes cannot change source facts, hard gates, score or saved state.
      store.saveReview(cacheKey, {
        jobId: job.id,
        rankingHash: fingerprint(ranking),
        asOf,
        scorerVersion: part.scorerVersion,
        contentHash: job.contentSha256,
        profileVersion: profile.version,
        model: config.model,
        text: turn.text,
        estimatedUsd: cost?.usd ?? null,
        createdAt: Date.now(),
      });
      if (!cost) throw new Error('ACCOUNTING_UNAVAILABLE');
      spent += cost.usd;
      if (spent > request.maxUsd) throw new Error('BUDGET_EXCEEDED');
    } finally {
      if (!accounted)
        settings.recordUsage({
          requestId: randomUUID(),
          profileId: config.id,
          inputTokens: 0,
          outputTokens: 0,
          source: 'unavailable',
          estimatedUsd: null,
          pricingVersion: null,
          status: signal.aborted ? 'canceled' : 'failed',
        });
    }
  }
}
