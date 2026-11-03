import { expect, it } from 'vitest';
import { DictationService } from './dictation';
import type { DictationEvent } from '@rovdo/shared';
import type { CliRuntime } from './cli-runtime';
it('reports native initialization exit failures instead of silently stopping', async () => {
  const events: DictationEvent[] = [];
  const runtime = {
    run: async () => ({ stdout: '', stderr: 'private diagnostic', exitCode: 1 }),
    shutdown: async () => {},
  } as unknown as CliRuntime;
  const service = new DictationService(runtime, 'win32');
  service.start(crypto.randomUUID(), (event) => events.push(event));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(events.some((event) => event.state === 'failed')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private diagnostic');
  await service.shutdown();
});
it('runs only the fixed local recognizer, gates unsupported systems, and cancels late events', async () => {
  const events: DictationEvent[] = [];
  let output!: (value: string) => void;
  let signal!: AbortSignal;
  const runtime = {
    run: async (
      _launcher: unknown,
      args: string[],
      _input: string,
      s: AbortSignal,
      _timeout: number,
      onText: (value: string) => void,
    ) => {
      expect(args).toContain('-NoProfile');
      expect(args).toContain('-EncodedCommand');
      signal = s;
      output = onText;
      await new Promise<void>((resolve) =>
        s.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    shutdown: async () => {},
  } as unknown as CliRuntime;
  const unsupported = new DictationService(runtime, 'linux');
  expect(unsupported.supported).toBe(false);
  const service = new DictationService(runtime, 'win32');
  const requestId = crypto.randomUUID();
  service.start(requestId, (e) => events.push(e));
  output('{"state":"listening"}\n{"state":"text","text":"hello"}\n');
  expect(events.at(-1)).toMatchObject({ requestId, state: 'text', text: 'hello' });
  service.stop(requestId);
  expect(signal.aborted).toBe(true);
  const length = events.length;
  output('{"state":"text","text":"late"}\n');
  expect(events).toHaveLength(length);
  await service.shutdown();
});
