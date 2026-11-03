import { expect, it, vi } from 'vitest';
import { SettingsStore } from '@rovdo/storage';
import type { ChatEvent, NormalizedMessage } from '@rovdo/shared';
import { ByokService } from './byok-service';
import type { CliService } from './cli-service';
import { handleByok } from './byok-ipc';
import { BYOK_CHANNELS } from '@rovdo/shared';
import { APP_URL } from './security';

const profileId = '9b1b7310-0604-4aaa-8000-000000000002';
it('does not block existing API profile editing while a local version scan is pending', async () => {
  const store = new SettingsStore(':memory:');
  let finish!: () => void;
  const scan = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cli = {
    scan: () => scan,
    views: () => [],
    idForProfile: () => undefined,
  } as unknown as CliService;
  const service = new ByokService(
    store,
    { get: vi.fn(), has: vi.fn(), enter: vi.fn(), remove: vi.fn() },
    undefined,
    'test',
    cli,
  );
  const pending = service.refreshClis();
  try {
    await expect(
      service.save({
        id: '6df0fdc2-065d-47a8-b0c9-5f5bf1cf2583',
        label: 'API during scan',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'fixture',
        timeoutMs: 5000,
        maxOutputTokens: 128,
        includeUsage: true,
      }),
    ).resolves.toBeUndefined();
    expect(store.list()[0]?.label).toBe('API during scan');
  } finally {
    finish();
    await pending;
    store.close();
  }
});
it('uses text-only CLI chat with committed context, unknown cost, no vault or workspace tools', async () => {
  const store = new SettingsStore(':memory:');
  const calls: NormalizedMessage[][] = [];
  const vault = { get: vi.fn(), has: vi.fn(), enter: vi.fn(), remove: vi.fn() };
  const adapter = {
    generate: vi.fn(
      async (
        request: { messages: NormalizedMessage[]; tools: unknown[] },
        _signal: AbortSignal,
        onText: (s: string) => void,
      ) => {
        expect(request.tools).toEqual([]);
        calls.push(structuredClone(request.messages));
        onText('hello');
        return {
          text: 'hello',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, source: 'unavailable' as const },
          stopReason: 'stop' as const,
        };
      },
    ),
  };
  const cli = {
    idForProfile: (id: string) => (id === profileId ? 'claude' : undefined),
    views: () => [{ id: 'claude', status: 'connected' }],
    assertAccess: async () => {},
    adapter: async () => adapter,
    shutdown: async () => {},
  } as unknown as CliService;
  const service = new ByokService(store, vault, undefined, 'test', cli);
  const events: ChatEvent[] = [];
  try {
    const request = {
      profileId,
      requestId: crypto.randomUUID(),
      text: 'one',
      consent: true,
      maxUsd: 1,
      cliManagedCost: true,
    };
    await service.run(request, (e) => events.push(e));
    await service.run(
      {
        ...request,
        requestId: crypto.randomUUID(),
        text: 'two',
        context: [
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'hello' },
        ],
      },
      (e) => events.push(e),
    );
    expect(calls[1]).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'two' },
    ]);
    expect(events.filter((e) => e.type === 'usage').every((e) => e.estimatedUsd === null)).toBe(
      true,
    );
    expect(vault.get).not.toHaveBeenCalled();
    expect(store.usage().unpricedRequests).toBe(2);
    await service.run(
      { ...request, requestId: crypto.randomUUID(), cliManagedCost: undefined },
      (e) => events.push(e),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      status: 'failed',
      code: 'VALIDATION_ERROR',
    });
  } finally {
    await service.shutdown();
    store.close();
  }
});
it('validates CLI IPC, rejects paths/commands and prevents untrusted refresh', async () => {
  const refreshClis = vi.fn(async () => {}),
    saveCli = vi.fn(async () => {});
  const service = { refreshClis, saveCli } as unknown as ByokService;
  const trusted = { url: APP_URL, isMainFrame: true, ownsWindow: true };
  expect(
    await handleByok(
      service,
      BYOK_CHANNELS.cliRefresh,
      {},
      { ...trusted, ownsWindow: false },
      () => {},
    ),
  ).toEqual({ ok: false, code: 'IPC_FORBIDDEN' });
  expect(
    await handleByok(
      service,
      BYOK_CHANNELS.cliSave,
      { id: 'claude', model: 'sonnet', timeoutMs: 30000, executable: 'cmd.exe' },
      trusted,
      () => {},
    ),
  ).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
  expect(await handleByok(service, BYOK_CHANNELS.cliRefresh, {}, trusted, () => {})).toEqual({
    ok: true,
  });
  expect(refreshClis).toHaveBeenCalledTimes(1);
  expect(saveCli).not.toHaveBeenCalled();
  for (const [channel, payload] of [
    [BYOK_CHANNELS.filesPick, { kind: 'files', path: 'C:/private' }],
    [BYOK_CHANNELS.filesRelease, { ids: ['C:/private'] }],
    [
      BYOK_CHANNELS.cliAccess,
      { id: 'claude', identity: 'a'.repeat(64), chat: true, selectedFiles: true, browser: true },
    ],
    [BYOK_CHANNELS.dictation, { op: 'start', requestId: crypto.randomUUID() }],
    [
      BYOK_CHANNELS.dictation,
      { op: 'start', requestId: crypto.randomUUID(), consent: true, command: 'whoami' },
    ],
  ] as const) {
    expect(await handleByok(service, channel, payload, trusted, () => {})).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(
      await handleByok(service, channel, payload, { ...trusted, isMainFrame: false }, () => {}),
    ).toEqual({ ok: false, code: 'IPC_FORBIDDEN' });
  }
});

it('rejects CLI chat before launching a process when persistent permission is absent', async () => {
  const store = new SettingsStore(':memory:');
  const adapter = vi.fn();
  const cli = {
    idForProfile: () => 'claude',
    views: () => [{ id: 'claude', status: 'connected' }],
    assertAccess: async () => {
      throw new Error('CLI_AUTHORIZATION_REQUIRED');
    },
    adapter,
    shutdown: async () => {},
  } as unknown as CliService;
  const service = new ByokService(
    store,
    { get: vi.fn(), has: vi.fn(), enter: vi.fn(), remove: vi.fn() },
    undefined,
    'test',
    cli,
  );
  const events: ChatEvent[] = [];
  try {
    await service.run(
      {
        profileId,
        requestId: crypto.randomUUID(),
        text: 'private draft',
        consent: true,
        maxUsd: 1,
        cliManagedCost: true,
      },
      (e) => events.push(e),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      status: 'failed',
      code: 'CLI_AUTHORIZATION_REQUIRED',
    });
    expect(adapter).not.toHaveBeenCalled();
  } finally {
    await service.shutdown();
    store.close();
  }
});

it('reserves CLI identity IDs so an API profile cannot masquerade as a CLI destination', async () => {
  const store = new SettingsStore(':memory:');
  const cli = {
    idForProfile: (id: string) => (id === profileId ? 'claude' : undefined),
  } as unknown as CliService;
  const service = new ByokService(
    store,
    { get: vi.fn(), has: vi.fn(), enter: vi.fn(), remove: vi.fn() },
    undefined,
    'test',
    cli,
  );
  try {
    await expect(
      service.save({
        id: profileId,
        label: 'API',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'fixture',
        timeoutMs: 5000,
        maxOutputTokens: 128,
        includeUsage: true,
      }),
    ).rejects.toThrow('VALIDATION_ERROR');
    expect(store.list()).toEqual([]);
  } finally {
    store.close();
  }
});
