import { it, expect, vi } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';

it('bounds unavailable archive retries, keeps independent feeds running and reports partial completion', async () => {
  const store = new CareerStore(':memory:');
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (url) => {
      if (url.includes('remotive.com'))
        return { status: 200, headers: {}, body: Buffer.from('{"jobs":[]}') };
      if (url.includes('web.archive.org'))
        throw new DOMException('request timed out', 'TimeoutError');
      return { status: 504, headers: {}, body: Buffer.from('Gateway timeout') };
    },
  });
  try {
    vi.useFakeTimers({ toFake: ['Date'] });
    const id = engine.start({
      sourceIds: ['wayback', 'common-crawl', 'remotive', 'lever'],
      overrides: {},
    });
    await engine.tick();
    await engine.tick();
    expect(store.global.coverage(id).find((s) => s.sourceId === 'wayback')?.error).toBe(
      'REQUEST_TIMEOUT',
    );
    expect(store.global.coverage(id).find((s) => s.sourceId === 'remotive')?.status).toBe('ready');
    vi.setSystemTime(Date.now() + 61000);
    await engine.tick();
    expect(store.global.run(id).status).toBe('completed');
    expect(store.global.coverage(id).find((s) => s.sourceId === 'common-crawl')).toMatchObject({
      status: 'blocked',
      requests: 2,
      error: 'HTTP_504',
    });
    expect(engine.view().coverage.find((s) => s.sourceId === 'lever')).toMatchObject({
      status: 'no-employers-discovered',
    });
  } finally {
    vi.useRealTimers();
    await engine.shutdown();
    store.close();
  }
});
