import type { ChildProcess, ExecFileException } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promptForApiKey } from './native-vault';
import type { PromptRunner } from './native-vault';

const execute = vi.fn<PromptRunner>();
function result(error: ExecFileException | null, stdout = '', stderr = '') {
  execute.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: ExecFileException | null, stdout: string, stderr: string) => void;
    callback(error, stdout, stderr); return {} as ChildProcess;
  });
}
beforeEach(() => { execute.mockReset(); });
describe('native credential entry', () => {
  it('themes the native Windows credential body without passing credentials through arguments', async () => {
    result(null, 'secret-canary'); await promptForApiKey('win32', execute, true);
    const encoded = execute.mock.calls[0]![1].at(-1)!;
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain('#101725');
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).not.toContain('secret-canary');
  });
  it('returns only the pipe result to main without putting the key in process arguments', async () => {
    result(null, 'secret-canary');
    expect(await promptForApiKey('win32', execute)).toBe('secret-canary');
    expect(JSON.stringify(execute.mock.calls[0]?.slice(0, 3))).not.toContain('secret-canary');
    expect(execute.mock.calls[0]?.[2]).toMatchObject({ windowsHide: true, maxBuffer: 8192 });
  });
  it('does not report a Windows prompt failure as a user cancellation', async () => {
    result(Object.assign(new Error('secret-canary'), { code: 1 }));
    await expect(promptForApiKey('win32', execute)).rejects.toThrow('CREDENTIAL_ENTRY_UNAVAILABLE');
  });
  it('recognizes macOS cancellation but reports other prompt failures', async () => {
    result(Object.assign(new Error('canceled'), { code: 1 }), '', 'User canceled. (-128)');
    expect(await promptForApiKey('darwin', execute)).toBeNull();
    result(Object.assign(new Error('secret-canary'), { code: 1 }), '', 'Unavailable');
    await expect(promptForApiKey('darwin', execute)).rejects.toThrow('CREDENTIAL_ENTRY_UNAVAILABLE');
  });
  it('handles Linux cancellation and absent native-dialog support without a fallback', async () => {
    result(Object.assign(new Error('cancel'), { code: 1 }));
    expect(await promptForApiKey('linux', execute)).toBeNull();
    result(Object.assign(new Error('secret-canary'), { code: 'ENOENT' }));
    await expect(promptForApiKey('linux', execute)).rejects.toThrow('CREDENTIAL_ENTRY_UNAVAILABLE');
  });
});
