import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '@rovdo/storage';
import type { ChatEvent, ProviderConfig } from '@rovdo/shared';
import { completion } from '../../../../packages/providers/src/fixtures';
import { createAdapter, ProviderError } from '@rovdo/providers';
import { ByokService } from './byok-service';

const id = 'e7aca4d4-058c-49b9-8f41-ef362fe15d07';
const request = {
  requestId: id,
  profileId: id,
  text: 'Explain the workspace',
  consent: true as const,
  maxUsd: 1,
};
const profile: ProviderConfig = {
  id,
  label: 'Fixture',
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'fixture-model',
  timeoutMs: 5000,
  maxOutputTokens: 512,
  includeUsage: true,
  pricing: {
    inputPerMillion: 1,
    outputPerMillion: 2,
    cachedInputPerMillion: 0.5,
    version: 'fixture',
  },
};
const vault = () => ({
  get: vi.fn(async () => 'secret-canary'),
  has: async () => true,
  enter: async () => true,
  remove: async () => {},
});

describe.each(['openai', 'anthropic', 'compatible'] as const)('%s service integration', (kind) => {
  it('persists a tested profile then streams a safe tool roundtrip and usage', async () => {
    const store = new SettingsStore(':memory:');
    const secret = vault();
    let calls = 0;
    const config: ProviderConfig = {
      ...profile,
      kind,
      baseUrl:
        kind === 'anthropic'
          ? 'https://api.anthropic.com'
          : kind === 'compatible'
            ? 'https://models.example.com/v1'
            : profile.baseUrl,
    };
    const service = new ByokService(
      store,
      secret,
      (saved, key) => createAdapter(saved, key, async () => completion(kind, ++calls <= 2)),
      '0.1.0',
    );
    try {
      await service.save(config);
      await service.probe(id, true);
      expect(store.get(id).capabilities?.tools).toBe('supported');
      const events: ChatEvent[] = [];
      await service.run(request, (event) => events.push(event));
      expect(events.some((event) => event.type === 'tool' && event.name === 'workspace_info')).toBe(
        true,
      );
      expect(
        events
          .filter((event) => event.type === 'text')
          .map((event) => (event.type === 'text' ? event.text : ''))
          .join(''),
      ).toBe('Hello café');
      expect(events.at(-1)).toEqual({ type: 'done', requestId: id, status: 'completed' });
      expect(store.usage().inputTokens).toBeGreaterThanOrEqual(24);
      expect(JSON.stringify(await service.list())).not.toContain('secret-canary');
      expect(secret.get.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      store.close();
    }
  });
});

it('rejects forged capability reports, unconsented requests and budget overflow before provider calls', async () => {
  const store = new SettingsStore(':memory:');
  const make = vi.fn();
  const service = new ByokService(store, vault(), make, '0.1.0');
  try {
    await service.save(profile);
    await expect(
      service.save({
        ...profile,
        capabilities: {
          streaming: 'supported',
          tools: 'supported',
          reportedUsage: 'supported',
          vision: 'supported',
          jsonSchema: 'supported',
          nativeComputerUse: 'supported',
          checkedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.probe(id, false)).rejects.toThrow('VALIDATION_ERROR');
    const events: ChatEvent[] = [];
    await service.run(request, (event) => events.push(event));
    expect(events.at(-1)).toMatchObject({ type: 'done', code: 'CAPABILITY_REQUIRED' });
    expect(make).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});

it('cancels an in-flight call, releases the slot and allows explicit recovery', async () => {
  const store = new SettingsStore(':memory:');
  let attempt = 0;
  const service = new ByokService(
    store,
    vault(),
    (saved, key) => {
      const adapter = createAdapter(saved, key, async () => completion('openai'));
      if (++attempt === 1)
        return {
          ...adapter,
          generate: async (_request, signal) =>
            await new Promise((_, reject) =>
              signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true }),
            ),
        };
      return adapter;
    },
    '0.1.0',
  );
  try {
    store.save({
      ...profile,
      capabilities: {
        streaming: 'supported',
        tools: 'supported',
        reportedUsage: 'supported',
        vision: 'unknown',
        jsonSchema: 'unknown',
        nativeComputerUse: 'unknown',
        checkedAt: new Date().toISOString(),
      },
    });
    const events: ChatEvent[] = [];
    const running = service.run(request, (event) => events.push(event));
    await vi.waitFor(() => expect(attempt).toBe(1));
    service.cancel(id);
    await running;
    expect(events.at(-1)).toMatchObject({ status: 'canceled', code: 'CANCELED' });
    await service.run({ ...request, requestId: 'c646072e-20d8-408e-b5af-0305429601cd' }, (event) =>
      events.push(event),
    );
    expect(events.at(-1)).toMatchObject({ status: 'completed' });
  } finally {
    store.close();
  }
});

it('waits for cancellation accounting before shutdown closes storage', async () => {
  const store = new SettingsStore(':memory:');
  let started = false;
  const service = new ByokService(
    store,
    vault(),
    (saved, key) => ({
      ...createAdapter(saved, key, async () => completion('openai')),
      generate: async (_request, signal) =>
        await new Promise((_, reject) => {
          started = true;
          signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
        }),
    }),
    '0.1.0',
  );
  try {
    store.save({
      ...profile,
      capabilities: {
        streaming: 'supported',
        tools: 'supported',
        reportedUsage: 'supported',
        vision: 'unknown',
        jsonSchema: 'unknown',
        nativeComputerUse: 'unknown',
        checkedAt: new Date().toISOString(),
      },
    });
    const pending = service.run(request, () => {});
    await vi.waitFor(() => expect(started).toBe(true));
    await service.shutdown();
    await pending;
    expect(store.usage().unpricedRequests).toBe(1);
  } finally {
    store.close();
  }
});

it('blocks a request whose conservative estimated maximum exceeds its budget', async () => {
  const store = new SettingsStore(':memory:');
  const make = vi.fn();
  const service = new ByokService(store, vault(), make, '0.1.0');
  try {
    store.save({
      ...profile,
      capabilities: {
        streaming: 'supported',
        tools: 'supported',
        reportedUsage: 'supported',
        vision: 'unknown',
        jsonSchema: 'unknown',
        nativeComputerUse: 'unknown',
        checkedAt: new Date().toISOString(),
      },
    });
    const events: ChatEvent[] = [];
    await service.run({ ...request, maxUsd: 0.000001 }, (event) => events.push(event));
    expect(events.at(-1)).toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(make).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});

it('drops conversation state on window reset and does not replay a completed request ID', async () => {
  const store = new SettingsStore(':memory:');
  const bodies: string[] = [];
  const service = new ByokService(
    store,
    vault(),
    (saved, key) =>
      createAdapter(saved, key, async (url, init) => {
        bodies.push(await new Request(url, init).text());
        return completion('openai');
      }),
    '0.1.0',
  );
  try {
    store.save({
      ...profile,
      capabilities: {
        streaming: 'supported',
        tools: 'supported',
        reportedUsage: 'supported',
        vision: 'unknown',
        jsonSchema: 'unknown',
        nativeComputerUse: 'unknown',
        checkedAt: new Date().toISOString(),
      },
    });
    await service.run(request, () => {});
    await expect(service.run(request, () => {})).rejects.toThrow('VALIDATION_ERROR');
    service.reset();
    await service.run(
      { ...request, text: 'New window message', requestId: 'c646072e-20d8-408e-b5af-0305429601cd' },
      () => {},
    );
    expect(bodies[1]).not.toContain(request.text);
  } finally {
    store.close();
  }
});

it('honors Retry-After across explicit connection attempts without hidden retries', async () => {
  const store = new SettingsStore(':memory:');
  const make = vi.fn(
    () =>
      ({
        probe: async () => {
          throw new ProviderError('RATE_LIMITED', 7000);
        },
      }) as unknown as ReturnType<typeof createAdapter>,
  );
  const service = new ByokService(store, vault(), make, '0.1.0');
  try {
    store.save(profile);
    await expect(service.probe(id, true)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(service.probe(id, true)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(make).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
  }
});

it('uses no vault entry for an explicitly unauthenticated compatible profile', async () => {
  const store = new SettingsStore(':memory:');
  const credentials = {
    get: vi.fn(async () => {
      throw new Error('VAULT_UNAVAILABLE');
    }),
    has: vi.fn(async () => false),
    enter: async () => false,
    remove: async () => {},
  };
  const service = new ByokService(
    store,
    credentials,
    (saved, key) => createAdapter(saved, key, async () => completion('compatible', true)),
    '0.1.0',
  );
  try {
    await service.save({
      ...profile,
      kind: 'compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      authMode: 'none',
    });
    await service.probe(id, true);
    expect((await service.list()).profiles[0]!.credential).toBe('not-required');
    expect(credentials.get).not.toHaveBeenCalled();
    expect(credentials.has).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});
