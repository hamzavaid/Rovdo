import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatFiles } from './chat-files';
it('snapshots explicitly picked files, skips hidden/dependency trees and never follows junctions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovdo-chat-files-'));
  try {
    await mkdir(join(root, 'folder'));
    await mkdir(join(root, 'private'));
    await writeFile(join(root, 'folder', 'notes.txt'), 'approved content');
    await writeFile(join(root, 'folder', '.env'), 'SECRET');
    await writeFile(join(root, 'private', 'secret.txt'), 'OUTSIDE');
    await symlink(
      join(root, 'private'),
      join(root, 'folder', 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const files = new ChatFiles(async () => [join(root, 'folder')]);
    const picked = await files.pick('folders');
    expect(picked).toHaveLength(1);
    expect(picked[0]!.files).toEqual([{ name: 'folder/notes.txt', text: 'approved content' }]);
    await writeFile(join(root, 'folder', 'notes.txt'), 'changed later');
    expect(files.resolve([picked[0]!.id])[0]!.files[0]!.text).toBe('approved content');
    files.release([picked[0]!.id]);
    expect(() => files.resolve([picked[0]!.id])).toThrow('ATTACHMENT_UNAVAILABLE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('rejects oversized/binary input atomically and rejects forged capability IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovdo-chat-invalid-'));
  try {
    const file = join(root, 'big.txt');
    await writeFile(file, 'x'.repeat(65000));
    const files = new ChatFiles(async () => [file]);
    await expect(files.pick('files')).rejects.toThrow('ATTACHMENT_LIMIT');
    await writeFile(file, Buffer.from([0, 1, 2]));
    await expect(files.pick('files')).rejects.toThrow('ATTACHMENT_TYPE');
    expect(() => files.resolve([crypto.randomUUID()])).toThrow('ATTACHMENT_UNAVAILABLE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('invalidates an in-flight selection on reset and bounds repeated picks together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovdo-chat-reset-'));
  try {
    const file = join(root, 'notes.txt');
    await writeFile(file, 'x'.repeat(33000));
    let finish!: (paths: string[]) => void;
    const pendingFiles = new ChatFiles(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = pendingFiles.pick('files');
    pendingFiles.clear();
    finish([file]);
    await expect(pending).rejects.toThrow('ATTACHMENT_UNAVAILABLE');
    const files = new ChatFiles(async () => [file]);
    const first = await files.pick('files');
    await expect(files.pick('files')).rejects.toThrow('ATTACHMENT_LIMIT');
    expect(files.resolve([first[0]!.id])[0]!.files[0]!.text).toHaveLength(33000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
