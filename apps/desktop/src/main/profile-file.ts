import { Worker } from 'node:worker_threads';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ImportPreviewSchema } from '@rovdo/shared';
import type { ImportPreview } from '@rovdo/shared';

export async function readProfileFile(path: string, signal: AbortSignal): Promise<ImportPreview> {
  const format = extname(path).slice(1).toLowerCase(); const info = await stat(path);
  if (!info.isFile() || info.size > 5_000_000 || !['pdf', 'docx', 'txt', 'md', 'markdown', 'json', 'zip', 'csv'].includes(format)) throw new Error('FILE_LIMIT');
  const bytes = await readFile(path, { signal }); if (bytes.length > 5_000_000) throw new Error('FILE_LIMIT');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => /^(SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(entry[0]) && entry[1] !== undefined));
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'profile-worker.cjs'), { workerData: { format, bytes, name: basename(path), at: new Date().toISOString() }, env: { ...env, PDF2JSON_DISABLE_LOGS: '1' }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 }, stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    let finished = false;
    const end = (draft?: unknown) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); void worker.terminate(); const parsed = ImportPreviewSchema.safeParse(draft); if (parsed.success) resolve(parsed.data); else reject(new Error('IMPORT_FAILED_OR_UNSUPPORTED_DOCUMENT')); };
    const abort = () => end(); const timer = setTimeout(abort, 15000);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) end();
    worker.once('message', (message: { ok?: boolean; draft?: unknown }) => end(message.ok ? message.draft : undefined)); worker.once('error', () => end()); worker.once('exit', () => end());
  });
}
