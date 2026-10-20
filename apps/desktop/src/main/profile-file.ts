import { Worker } from 'node:worker_threads';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ImportPreviewSchema, ImportFailure, ImportFailureCodeSchema } from '@rovdo/shared';
import type { ImportPreview } from '@rovdo/shared';

export async function readProfileFile(path: string, signal: AbortSignal): Promise<ImportPreview> {
  const format = extname(path).slice(1).toLowerCase(); const info = await stat(path).catch(() => { throw new ImportFailure('FILE_UNREADABLE'); });
  if (!['pdf', 'docx', 'txt', 'md', 'markdown', 'json', 'zip', 'csv'].includes(format)) throw new ImportFailure('UNSUPPORTED_FILE');
  if (!info.isFile()) throw new ImportFailure('FILE_UNREADABLE'); if(info.size > 5_000_000)throw new ImportFailure('DOCUMENT_LIMIT');
  const bytes = await readFile(path, { signal }).catch(() => {throw new ImportFailure(signal.aborted?'IMPORT_CANCELED':'FILE_UNREADABLE');}); if (bytes.length > 5_000_000) throw new Error('FILE_LIMIT');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => /^(SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(entry[0]) && entry[1] !== undefined));
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'profile-worker.cjs'), { workerData: { format, bytes, name: basename(path), at: new Date().toISOString() }, env: { ...env, PDF2JSON_DISABLE_LOGS: '1' }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 }, stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    let finished = false;
    const end = (draft?: unknown, code: string = 'IMPORT_FAILED') => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); void worker.terminate(); const parsed = ImportPreviewSchema.safeParse(draft); if (parsed.success) resolve(parsed.data); else { const failure=ImportFailureCodeSchema.safeParse(code);reject(new ImportFailure(failure.success?failure.data:'IMPORT_FAILED')); } };
    const abort = () => end(undefined,'IMPORT_CANCELED'); const timer = setTimeout(() => end(undefined,'IMPORT_TIMEOUT'), 15000);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) end(undefined,'IMPORT_CANCELED');
    worker.once('message', (message: { ok?: boolean; draft?: unknown; code?: string }) => end(message.ok ? message.draft : undefined,message.ok?'IMPORT_VALIDATION':message.code)); worker.once('error', () => end(undefined,'MALFORMED_DOCUMENT')); worker.once('exit', () => end());
  });
}
