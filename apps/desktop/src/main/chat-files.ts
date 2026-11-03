/** Native selection creates bounded, session-only text snapshots. No renderer-supplied paths or CLI file tools. */
import { constants } from 'node:fs';
import { lstat, realpath, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatAttachmentSchema } from '@rovdo/shared';
import type { ChatAttachment } from '@rovdo/shared';
const textTypes = new Set(
  'txt md markdown csv json yaml yml xml html css js jsx mjs cjs ts tsx py rs go java c cpp h hpp sql sh rb toml'.split(
    ' ',
  ),
);
const excluded = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  'credentials',
  'secrets',
]);
const safeName = (name: string) =>
  [...name]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 200);
export class ChatFiles {
  private readonly items = new Map<string, { value: ChatAttachment; at: number }>();
  private picking = false;
  private selection: AbortController | null = null;
  constructor(
    private readonly picker: (kind: 'files' | 'folders') => Promise<string[]>,
    private readonly document?: (
      bytes: Buffer,
      format: 'pdf' | 'docx',
      signal: AbortSignal,
    ) => Promise<string>,
  ) {}
  clear() {
    this.selection?.abort();
    this.items.clear();
  }
  release(ids: string[]) {
    for (const id of ids) this.items.delete(id);
  }
  resolve(ids: string[]): ChatAttachment[] {
    if (new Set(ids).size !== ids.length) throw new Error('VALIDATION_ERROR');
    return ids.map((id) => {
      const item = this.items.get(id);
      if (!item || Date.now() - item.at > 1800000) {
        this.items.delete(id);
        throw new Error('ATTACHMENT_UNAVAILABLE');
      }
      return structuredClone(item.value);
    });
  }
  async pick(kind: 'files' | 'folders'): Promise<ChatAttachment[]> {
    if (this.picking) throw new Error('BUSY');
    this.picking = true;
    const controller = new AbortController();
    this.selection = controller;
    try {
      for (const [id, item] of this.items)
        if (Date.now() - item.at > 1800000) this.items.delete(id);
      const selected = await this.picker(kind);
      if (selected.length > 20 || this.items.size + selected.length > 20)
        throw new Error('ATTACHMENT_LIMIT');
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
      let count = 0,
        visited = 0,
        total = 0,
        sourceBytes = 0;
      const result: ChatAttachment[] = [];
      for (const selectedPath of selected) {
        signal.throwIfAborted();
        if (!path.isAbsolute(selectedPath)) throw new Error('ATTACHMENT_UNAVAILABLE');
        const rootInfo = await lstat(selectedPath);
        if (rootInfo.isSymbolicLink() || path.basename(selectedPath).startsWith('.'))
          throw new Error('ATTACHMENT_TYPE');
        const root = await realpath(selectedPath);
        if ((kind === 'folders') !== rootInfo.isDirectory()) throw new Error('ATTACHMENT_TYPE');
        const files: ChatAttachment['files'] = [];
        const name = safeName(path.basename(root));
        let bytes = 0;
        const visit = async (file: string, relativeName: string): Promise<void> => {
          signal.throwIfAborted();
          if (++visited > 250) throw new Error('ATTACHMENT_LIMIT');
          const info = await lstat(file);
          if (info.isSymbolicLink()) return;
          const resolved = await realpath(file);
          if (resolved !== root && !resolved.startsWith(root + path.sep))
            throw new Error('ATTACHMENT_UNAVAILABLE');
          if (info.isDirectory()) {
            const dir = await opendir(resolved);
            for await (const entry of dir) {
              if (entry.name.startsWith('.') || excluded.has(entry.name.toLowerCase())) continue;
              await visit(
                path.join(resolved, entry.name),
                relativeName + '/' + safeName(entry.name),
              );
            }
            return;
          }
          const format = path.extname(file).slice(1).toLowerCase();
          const binaryDocument = format === 'pdf' || format === 'docx';
          if (!textTypes.has(format) && !binaryDocument) {
            if (kind === 'files') throw new Error('ATTACHMENT_TYPE');
            return;
          }
          if (
            !info.isFile() ||
            ++count > 20 ||
            info.size > (binaryDocument ? 5000000 : 64000) ||
            (sourceBytes += info.size) > 5000000
          )
            throw new Error('ATTACHMENT_LIMIT');
          const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          let content: string;
          try {
            const actual = await handle.stat();
            if (actual.ino !== info.ino || actual.dev !== info.dev || !actual.isFile())
              throw new Error('ATTACHMENT_UNAVAILABLE');
            const buffer = Buffer.alloc(info.size + 1);
            let size = 0;
            while (size < buffer.length) {
              signal.throwIfAborted();
              const read = await handle.read(buffer, size, buffer.length - size, size);
              if (!read.bytesRead) break;
              size += read.bytesRead;
            }
            const after = await handle.stat();
            if (size !== info.size || after.mtimeMs !== info.mtimeMs)
              throw new Error('ATTACHMENT_UNAVAILABLE');
            const data = buffer.subarray(0, size);
            if (binaryDocument) {
              if (!this.document) throw new Error('ATTACHMENT_TYPE');
              content = await this.document(data, format, signal);
            } else {
              try {
                content = new TextDecoder('utf-8', { fatal: true }).decode(data);
              } catch {
                throw new Error('ATTACHMENT_TYPE');
              }
              if (content.includes('\0')) throw new Error('ATTACHMENT_TYPE');
            }
          } finally {
            await handle.close();
          }
          total += Buffer.byteLength(content);
          if (total > 64000) throw new Error('ATTACHMENT_LIMIT');
          bytes += info.size;
          files.push({ name: relativeName, text: content });
        };
        await visit(root, name);
        if (!files.length) throw new Error('ATTACHMENT_TYPE');
        files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        result.push(
          ChatAttachmentSchema.parse({
            id: randomUUID(),
            name,
            kind: kind === 'files' ? 'file' : 'folder',
            bytes,
            files,
          }),
        );
      }
      const retained = [...this.items.values()].reduce(
        (n, item) => n + item.value.files.reduce((m, f) => m + Buffer.byteLength(f.text), 0),
        0,
      );
      const retainedCount = [...this.items.values()].reduce(
        (n, item) => n + item.value.files.length,
        0,
      );
      if (retained + total > 64000 || retainedCount + count > 20)
        throw new Error('ATTACHMENT_LIMIT');
      signal.throwIfAborted();
      for (const value of result) this.items.set(value.id, { value, at: Date.now() });
      return structuredClone(result);
    } catch (error) {
      if (error instanceof Error && /^(ATTACHMENT_|BUSY)/.test(error.message)) throw error;
      throw new Error('ATTACHMENT_UNAVAILABLE', { cause: error });
    } finally {
      this.picking = false;
      if (this.selection === controller) this.selection = null;
    }
  }
}
