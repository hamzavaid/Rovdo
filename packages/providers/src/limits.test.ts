import { expect, it } from 'vitest';
import { createAdapter } from './index';
const config = () => ({
  id: 'e7aca4d4-058c-49b9-8f41-ef362fe15d07',
  label: 'Fixture',
  kind: 'compatible' as const,
  baseUrl: 'https://models.example.com/v1',
  model: 'fixture',
  timeoutMs: 5000,
  maxOutputTokens: 512,
  includeUsage: false,
});
import { sse } from './fixtures';

it('bounds unterminated provider streams before SDK line buffering and cancels the body', async () => {
  let canceled = false,
    chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (++chunks > 40) {
        c.close();
        return;
      }
      c.enqueue(new Uint8Array(262144).fill(65));
    },
    cancel() {
      canceled = true;
    },
  });
  const adapter = createAdapter(
    config(),
    'fixture-key',
    async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  );
  await expect(
    adapter.generate(
      { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(canceled).toBe(true);
});
it('rejects oversized fragmented tool identity before waiting for stream termination', async () => {
  const events = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'x'.repeat(201),
                function: { name: 'workspace_info', arguments: '{}' },
              },
            ],
          },
        },
      ],
    },
  ];
  const adapter = createAdapter(config(), 'fixture-key', async () => sse(events));
  await expect(
    adapter.generate(
      { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
