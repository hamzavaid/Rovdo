import { describe, expect, it, vi } from 'vitest';
import { createAdapter, ProviderError } from './index';
import { completion, sse } from './fixtures';
import type { ProviderConfig } from '@rovdo/shared';

export const config = (kind: ProviderConfig['kind']): ProviderConfig => ({
  id: 'e7aca4d4-058c-49b9-8f41-ef362fe15d07',
  label: 'Fixture',
  kind,
  baseUrl:
    kind === 'openai'
      ? 'https://api.openai.com/v1'
      : kind === 'anthropic'
        ? 'https://api.anthropic.com'
        : 'https://models.example.com/v1',
  model: 'fixture-model',
  timeoutMs: 5000,
  maxOutputTokens: 512,
  includeUsage: true,
  pricing: {
    inputPerMillion: 1,
    outputPerMillion: 2,
    cachedInputPerMillion: 0.5,
    version: 'fixture-v1',
  },
});
const tools = [
  {
    name: 'workspace_info',
    description: 'Read workspace information',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false as const },
  },
];

describe.each(['openai', 'anthropic', 'compatible'] as const)('%s provider contract', (kind) => {
  it('streams UTF-8 text, normalizes reported usage and estimates versioned cost', async () => {
    const calls: Request[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push(new Request(url, init));
      return completion(kind);
    };
    const adapter = createAdapter(config(kind), 'secret-canary', fetcher);
    const deltas: string[] = [];
    const result = await adapter.generate(
      { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
      new AbortController().signal,
      (delta) => deltas.push(delta),
    );
    expect(result.text).toBe('Hello café');
    expect(deltas.join('')).toBe('Hello café');
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 5, source: 'reported' });
    expect(adapter.estimateCost(result.usage)?.usd).toBeGreaterThan(0);
    expect(adapter.estimateCost(result.usage)?.pricingVersion).toBe('fixture-v1');
    expect(calls[0]!.headers.get(kind === 'anthropic' ? 'x-api-key' : 'authorization')).toContain(
      'secret-canary',
    );
    expect(await calls[0]!.text()).not.toContain('secret-canary');
  });

  it('accumulates fragmented tool arguments and serializes tool results for the next turn', async () => {
    const bodies: unknown[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return completion(kind, bodies.length === 1);
    };
    const adapter = createAdapter(config(kind), 'secret-canary', fetcher);
    const first = await adapter.generate(
      { messages: [{ role: 'user', content: 'About workspace' }], tools },
      new AbortController().signal,
    );
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'workspace_info', arguments: {} }]);
    const second = await adapter.generate(
      {
        messages: [
          { role: 'user', content: 'About workspace' },
          { role: 'assistant', content: first.text, toolCalls: first.toolCalls },
          { role: 'tool', content: '{"name":"Rovdo"}', toolCallId: 'call_1' },
        ],
        tools,
      },
      new AbortController().signal,
    );
    expect(second.text).toBe('Hello café');
    expect(JSON.stringify(bodies[1])).toContain('call_1');
    expect(JSON.stringify(bodies[1])).toContain('Rovdo');
  });

  it('probes the configured model instead of assuming capabilities', async () => {
    const adapter = createAdapter(config(kind), 'secret-canary', async () =>
      completion(kind, true),
    );
    const probe = await adapter.probe(new AbortController().signal);
    expect(probe).toMatchObject({
      streaming: 'supported',
      tools: 'supported',
      reportedUsage: 'supported',
      vision: 'unknown',
      jsonSchema: 'unknown',
    });
  });

  it('redacts a credential echoed across stream fragments', async () => {
    const adapter = createAdapter(config(kind), 'Hello café', async () => completion(kind));
    const deltas: string[] = [];
    const result = await adapter.generate(
      { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
      new AbortController().signal,
      (text) => deltas.push(text),
    );
    expect(result.text).toBe('[redacted]');
    expect(deltas.join('')).toBe('[redacted]');
  });

  it.each([401, 429, 503])('sanitizes HTTP %i without replaying a request', async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response('secret-canary private error', { status, headers: { 'retry-after': '7' } }),
    );
    const adapter = createAdapter(config(kind), 'secret-canary', fetcher);
    const failure = await adapter
      .generate(
        { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
        new AbortController().signal,
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(String(failure)).not.toContain('secret-canary');
    expect(fetcher).toHaveBeenCalledTimes(1);
    if (status === 429) expect(failure).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 7000 });
  });

  it('supports recovery on a subsequent explicit attempt', async () => {
    let count = 0;
    const adapter = createAdapter(config(kind), 'secret-canary', async () =>
      ++count === 1 ? new Response('', { status: 503 }) : completion(kind),
    );
    await expect(
      adapter.generate({ messages: [], tools: [] }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(
      (await adapter.generate({ messages: [], tools: [] }, new AbortController().signal)).text,
    ).toBe('Hello café');
  });
  it('never places a vault credential into model messages', async () => {
    const fetcher = vi.fn(async () => completion(kind));
    const adapter = createAdapter(config(kind), 'secret-canary', fetcher);
    await expect(
      adapter.generate(
        { messages: [{ role: 'user', content: 'secret-canary' }], tools: [] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('ignores ambient credential/header settings in favor of the scoped vault key', async () => {
    vi.stubEnv(
      'OPENAI_CUSTOM_HEADERS',
      'Authorization: Bearer ambient-secret\nCookie: ambient-cookie',
    );
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'x-api-key: ambient-secret\nCookie: ambient-cookie');
    try {
      const headers: Headers[] = [];
      const adapter = createAdapter(config(kind), 'secret-canary', async (url, init) => {
        headers.push(new Request(url, init).headers);
        return completion(kind);
      });
      await adapter.generate(
        { messages: [{ role: 'user', content: 'Hello' }], tools: [] },
        new AbortController().signal,
      );
      expect(headers[0]!.get(kind === 'anthropic' ? 'x-api-key' : 'authorization')).toContain(
        'secret-canary',
      );
      expect(headers[0]!.get('cookie')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

it('rejects malformed and undeclared tool calls rather than executing them', async () => {
  for (const name of ['shell_execute', 'workspace_info']) {
    const adapter = createAdapter(config('openai'), 'secret-canary', async () =>
      sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name, arguments: 'invalid-json' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]),
    );
    await expect(
      adapter.generate({ messages: [], tools }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
});

it('labels missing usage and missing prices as unavailable', async () => {
  const profile = config('openai');
  delete profile.pricing;
  const adapter = createAdapter(profile, 'secret', async () =>
    sse([{ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }]),
  );
  const turn = await adapter.generate({ messages: [], tools: [] }, new AbortController().signal);
  expect(turn.usage.source).toBe('unavailable');
  expect(adapter.estimateCost(turn.usage)).toBeNull();
});

it('rejects cancellation and truncated streams, preserving no fabricated success', async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = createAdapter(config('openai'), 'secret', async () =>
    sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: null }] }]),
  );
  await expect(
    adapter.generate({ messages: [], tools: [] }, controller.signal),
  ).rejects.toMatchObject({ code: 'CANCELED' });
  await expect(
    adapter.generate({ messages: [], tools: [] }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('supports an explicitly unauthenticated compatible server without an Authorization header', async () => {
  let authorization: string | null = 'unexpected';
  const adapter = createAdapter(
    { ...config('compatible'), authMode: 'none' },
    '',
    async (url, init) => {
      authorization = new Request(url, init).headers.get('authorization');
      return completion('compatible');
    },
  );
  expect(
    (
      await adapter.generate(
        { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
        new AbortController().signal,
      )
    ).text,
  ).toBe('Hello café');
  expect(authorization).toBeNull();
});
