/**
 * Maps SDK/network exceptions into the public provider error vocabulary.
 * Preserve retryability and cancellation without returning raw provider messages to the renderer.
 */
import type { FailureCode } from '@rovdo/shared';

export class ProviderError extends Error {
  constructor(
    readonly code: FailureCode,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

export function normalizeError(error: unknown, signal?: AbortSignal): ProviderError {
  if (signal?.aborted) return new ProviderError('CANCELED');
  if (error instanceof ProviderError) return error;
  let nested: unknown = error;
  for (
    let index = 0;
    index < 4 && nested && typeof nested === 'object' && 'cause' in nested;
    index++
  ) {
    nested = nested.cause;
    if (nested instanceof ProviderError) return nested;
  }
  const candidate = error as { status?: number; name?: string; headers?: Headers } | null;
  if (candidate?.name === 'APIUserAbortError' || candidate?.name === 'AbortError')
    return new ProviderError('CANCELED');
  if (candidate?.name === 'APIConnectionTimeoutError' || candidate?.name === 'TimeoutError')
    return new ProviderError('TIMEOUT');
  if (candidate?.status === 401 || candidate?.status === 403)
    return new ProviderError('AUTH_FAILED');
  if (candidate?.status === 429) {
    const header = candidate.headers?.get('retry-after');
    const seconds = header ? Number(header) : NaN;
    const retryAfterMs = Number.isFinite(seconds)
      ? Math.min(Math.max(0, seconds * 1000), 300_000)
      : Math.max(0, Math.min(300_000, Date.parse(header ?? '') - Date.now()));
    return new ProviderError('RATE_LIMITED', Number.isFinite(retryAfterMs) ? retryAfterMs : 1000);
  }
  if (candidate?.status && candidate.status < 500) return new ProviderError('INVALID_RESPONSE');
  return new ProviderError('PROVIDER_UNAVAILABLE');
}
