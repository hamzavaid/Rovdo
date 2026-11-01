import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { readPublic } from './network';
it('rejects initial abort before resolving DNS', async () => {
  const c = new AbortController();
  c.abort();
  await expect(readPublic('https://jobs.example', { signal: c.signal })).rejects.toThrow();
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});
it('bounds hanging DNS and prevents HTTP after late resolution', async () => {
  let finish!: (v: { address: string; family: number }[]) => void;
  mocks.lookup.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const c = new AbortController();
  const pending = readPublic('https://jobs.example', { signal: c.signal });
  c.abort();
  await expect(pending).rejects.toThrow();
  finish([{ address: '8.8.8.8', family: 4 }]);
  await Promise.resolve();
  expect(mocks.request).not.toHaveBeenCalled();
});
it('applies the total deadline to DNS', async () => {
  vi.useFakeTimers();
  mocks.lookup.mockImplementation(() => new Promise(() => {}));
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('TIMEOUT')), ms);
    return controller.signal;
  });
  try {
    const result = readPublic('https://jobs.example').catch((e) => e);
    await vi.advanceTimersByTimeAsync(15001);
    expect(await result).toMatchObject({ message: 'TIMEOUT' });
    expect(mocks.request).not.toHaveBeenCalled();
  } finally {
    timeout.mockRestore();
    vi.useRealTimers();
  }
});
