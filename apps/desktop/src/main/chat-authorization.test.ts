import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore } from '@rovdo/storage';
import { CliService } from './cli-service';
import { CliRuntime } from './cli-runtime';
it('remembers tested CLI permissions across restart and invalidates material model/identity changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovdo-chat-authorization-'));
  let store = new SettingsStore(join(root, 'settings.sqlite'));
  const script = join(root, 'fixture.cjs');
  await writeFile(
    script,
    `if(process.argv.includes('--version')){console.log('2.1.248');process.exit(0)}process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',result:'ok'})));`,
  );
  const options = {
    find: async (id: string) =>
      id === 'claude' ? { executable: process.execPath, prefix: [script] } : null,
  };
  let service = new CliService(store, options);
  try {
    service.save({ id: 'claude', model: 'fixture', timeoutMs: 60000 });
    await service.scan();
    await service.test('claude', new AbortController().signal);
    const identity = service.views().find((v) => v.id === 'claude')!.accessIdentity!;
    await service.setAccess({ id: 'claude', identity, chat: true, selectedFiles: true });
    await service.assertAccess('claude', 'selectedFiles');
    await service.shutdown();
    store.close();
    store = new SettingsStore(join(root, 'settings.sqlite'));
    service = new CliService(store, options);
    await service.scan();
    expect(service.views().find((v) => v.id === 'claude')).toMatchObject({
      status: 'connected',
      authorization: { chat: true, selectedFiles: true },
    });
    service.save({ id: 'claude', model: 'fixture', timeoutMs: 30000 });
    await service.assertAccess('claude', 'chat');
    const failedProbe = vi
      .spyOn(CliRuntime.prototype, 'run')
      .mockRejectedValueOnce(new Error('AUTH_FAILED'));
    await expect(service.test('claude', new AbortController().signal)).rejects.toThrow(
      'AUTH_FAILED',
    );
    failedProbe.mockRestore();
    await service.scan(true);
    expect(service.views().find((v) => v.id === 'claude')!.status).toBe('installed');
    await expect(service.assertAccess('claude', 'chat')).rejects.toThrow(
      'CLI_AUTHORIZATION_REQUIRED',
    );
    await service.test('claude', new AbortController().signal);
    await service.assertAccess('claude', 'chat'); // Re-testing the same identity retains approval.
    await service.setAccess({ id: 'claude', identity, chat: false, selectedFiles: false });
    await expect(service.assertAccess('claude', 'chat')).rejects.toThrow(
      'CLI_AUTHORIZATION_REQUIRED',
    );
    await service.setAccess({ id: 'claude', identity, chat: true, selectedFiles: false });
    await expect(service.assertAccess('claude', 'selectedFiles')).rejects.toThrow(
      'CLI_AUTHORIZATION_REQUIRED',
    );
    const source = await import('node:fs/promises');
    await source.appendFile(script, '\n// changed executable identity');
    await expect(service.assertAccess('claude', 'chat')).rejects.toThrow(
      'CLI_AUTHORIZATION_REQUIRED',
    );
    await service.scan(true);
    expect(service.views().find((v) => v.id === 'claude')!.status).toBe('installed');
    await service.test('claude', new AbortController().signal);
    expect(service.views().find((v) => v.id === 'claude')!.authorization?.chat).toBe(false);
    service.save({ id: 'claude', model: 'different', timeoutMs: 30000 });
    await expect(service.assertAccess('claude', 'chat')).rejects.toThrow(
      'CLI_AUTHORIZATION_REQUIRED',
    );
    await expect(
      service.setAccess({ id: 'claude', identity, chat: true, selectedFiles: true }),
    ).rejects.toThrow();
  } finally {
    await service.shutdown();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
