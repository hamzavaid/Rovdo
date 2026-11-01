/** Bound raw bytes before SDK SSE/JSON buffering. Limits apply equally to fixture and native transports. */
import { ProviderError } from './errors';
export function boundedFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    if (!response.body) return response;
    const reader = response.body.getReader();
    let bytes = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            reader.releaseLock();
            return;
          }
          bytes += next.value.byteLength;
          if (bytes > 8_000_000) {
            await reader.cancel().catch(() => {});
            throw new ProviderError('INVALID_RESPONSE');
          }
          controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {});
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
