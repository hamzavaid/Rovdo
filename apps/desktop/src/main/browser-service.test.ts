import { describe, expect, it } from 'vitest';
import { SettingsStore, RuntimeStore } from '@rovdo/storage';
import { createAdapter } from '@rovdo/providers';
import type { BrowserRequest, ProviderConfig } from '@rovdo/shared';
import { createBrowserService } from './browser-service';

const sender = { url: 'rovdo://app/index.html', isMainFrame: true, ownsWindow: true };
describe('browser IPC and provider integration', () => {
  it.each(['openai', 'anthropic', 'compatible'] as const)(
    'executes a scoped %s tool proposal without exposing its key',
    async (kind) => {
      const settings = new SettingsStore(':memory:');
      const runs = new RuntimeStore(':memory:');
      const config: ProviderConfig = {
        id: '00000000-0000-4000-8000-000000000001',
        label: kind,
        kind,
        model: 'fixture',
        baseUrl:
          kind === 'anthropic'
            ? 'https://api.anthropic.com'
            : kind === 'openai'
              ? 'https://api.openai.com/v1'
              : 'https://model.example.com/v1',
        timeoutMs: 1000,
        maxOutputTokens: 128,
        includeUsage: true,
        pricing: { inputPerMillion: 0, outputPerMillion: 0, version: 'fixture' },
        capabilities: {
          tools: 'supported',
          streaming: 'supported',
          reportedUsage: 'supported',
          vision: 'unknown',
          jsonSchema: 'unknown',
          nativeComputerUse: 'unknown',
          checkedAt: new Date().toISOString(),
        },
      };
      settings.save(config);
      let done = false;
      let keyReads = 0;
      const service = createBrowserService(
        runs,
        settings,
        {
          async get() {
            keyReads++;
            return 'vault-secret-canary';
          },
        },
        (c, k) =>
          createAdapter(c, k, async (input) => {
            const req = new Request(input);
            const body = await req.text();
            expect(body).toContain('browser_action');
            expect(body).toContain('untrustedPage');
            expect(body).not.toContain('vault-secret-canary');
            const args = JSON.stringify({ action: { tool: 'snapshot' } });
            const events =
              kind === 'anthropic'
                ? [
                    {
                      type: 'message_start',
                      message: {
                        id: 'msg_1',
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        usage: { input_tokens: 2, output_tokens: 0 },
                      },
                    },
                    {
                      type: 'content_block_start',
                      index: 0,
                      content_block: {
                        type: 'tool_use',
                        id: 'call_1',
                        name: 'browser_action',
                        input: {},
                      },
                    },
                    {
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'input_json_delta', partial_json: args },
                    },
                    {
                      type: 'message_delta',
                      delta: { stop_reason: 'tool_use' },
                      usage: { output_tokens: 1 },
                    },
                    { type: 'message_stop' },
                  ]
                : [
                    {
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: 0,
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'browser_action', arguments: args },
                              },
                            ],
                          },
                          finish_reason: 'tool_calls',
                        },
                      ],
                    },
                    { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1 } },
                  ];
            return new Response(
              events
                .map(
                  (e) => `${'type' in e ? `event: ${e.type}\n` : ''}data: ${JSON.stringify(e)}\n\n`,
                )
                .join('') + (kind === 'anthropic' ? '' : 'data: [DONE]\n\n'),
              { headers: { 'content-type': 'text/event-stream' } },
            );
          }),
        () => ({
          async open() {},
          async observe() {
            return {
              url: 'https://example.com/',
              text: done ? 'Verified goal' : 'Untrusted page',
              challenge: false,
            };
          },
          async execute() {
            done = true;
            return { verified: true, kind: 'snapshot' };
          },
          async close() {},
        }),
      );
      try {
        expect(await service.command({ op: 'list' }, { ...sender, ownsWindow: false })).toEqual({
          ok: false,
          code: 'IPC_FORBIDDEN',
        });
        expect(await service.command({ op: 'list', arbitrary: true }, sender)).toEqual({
          ok: false,
          code: 'VALIDATION_ERROR',
        });
        const request: BrowserRequest = {
          task: 'Read a page',
          startUrl: 'https://example.com/',
          allowedOrigins: ['https://example.com'],
          expectedText: 'Verified goal',
          modelProfileId: config.id,
          maxSteps: 2,
          maxUsd: 1,
          maxTokens: 50000,
          maxDurationMs: 60000,
          consent: true,
        };
        expect((await service.command({ op: 'start', request }, sender)).ok).toBe(true);
        await service.runtime.settled();
        expect(runs.list()[0]!.state).toBe('COMPLETED');
        expect(keyReads).toBe(1);
        expect(settings.usage().requests).toBe(1);
        expect(JSON.stringify(runs.list())).not.toContain('vault-secret-canary');
      } finally {
        await service.runtime.shutdown();
        runs.close();
        settings.close();
      }
    },
  );
});
