import { describe, expect, it, vi } from 'vitest';
import { BYOK_CHANNELS } from '@rovdo/shared';
import { handleByok } from './byok-ipc';
import type { ByokService } from './byok-service';
import { APP_URL } from './security';

const trusted = { url: APP_URL, isMainFrame: true, ownsWindow: true };
describe('BYOK IPC boundary', () => {
  it.each([
    { ...trusted, url: 'https://evil.example' },
    { ...trusted, isMainFrame: false },
    { ...trusted, ownsWindow: false },
  ])('rejects untrusted caller before invoking services', async (sender) => {
    const list = vi.fn();
    expect(
      await handleByok(
        { list } as unknown as ByokService,
        BYOK_CHANNELS.settings,
        {},
        sender,
        () => {},
      ),
    ).toEqual({ ok: false, code: 'IPC_FORBIDDEN' });
    expect(list).not.toHaveBeenCalled();
  });
  it('rejects credential-bearing payloads and arbitrary channels', async () => {
    const enterKey = vi.fn();
    const service = { enterKey } as unknown as ByokService;
    expect(
      await handleByok(
        service,
        BYOK_CHANNELS.enterKey,
        { profileId: 'e7aca4d4-058c-49b9-8f41-ef362fe15d07', apiKey: 'secret-canary' },
        trusted,
        () => {},
      ),
    ).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await handleByok(service, 'shell.execute', {}, trusted, () => {})).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(enterKey).not.toHaveBeenCalled();
  });
  it('maps sensitive exceptions to fixed public codes', async () => {
    const service = {
      list: async () => {
        throw new Error('secret-canary');
      },
    } as unknown as ByokService;
    expect(await handleByok(service, BYOK_CHANNELS.settings, {}, trusted, () => {})).toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
    });
  });
});
