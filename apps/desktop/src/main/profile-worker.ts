import { parentPort, workerData } from 'node:worker_threads';
import { extractDocument, previewDocument, previewText, sha } from '@rovdo/profile-import';

// Text extraction does not need generated font code. Disable the parser's
// dynamic-code path in this disposable worker before reading untrusted bytes.
const originalFunction = globalThis.Function;
const originalEval = globalThis.eval;
process.env.PDF2JSON_DISABLE_LOGS = '1';
void (async () => {
  try {
    const { format, bytes, name, at } = workerData as { format: string; bytes: Uint8Array; name: string; at: string };
    const buffer = Buffer.from(bytes);
    Object.defineProperty(globalThis, 'Function', { value: function blocked() { throw new Error('DYNAMIC_CODE_DISABLED'); }, configurable: true });
    Object.defineProperty(globalThis, 'eval', { value: function blocked() { throw new Error('DYNAMIC_CODE_DISABLED'); }, configurable: true });
    const document = await extractDocument(format, buffer);
    // Zod's trusted fixed-schema validator uses code generation internally.
    // Restore it only after untrusted binary parsing is complete.
    Object.defineProperty(globalThis, 'Function', { value: originalFunction, configurable: true });
    Object.defineProperty(globalThis, 'eval', { value: originalEval, configurable: true });
    const draft = format === 'json' ? previewText(buffer.toString('utf8').replace(/^\uFEFF/, ''), name, 'file', at, 'json') : previewDocument(document, name, format === 'zip' || format === 'csv' ? 'linkedin' : 'file', at);
    const hash = sha(buffer); draft.id = `import:${hash}`; draft.source.sha256 = hash; draft.source.id = `source:${hash}`;
    draft.intelligence.evidence.forEach((e) => { e.sourceId = draft.source.id; });
    parentPort?.postMessage({ ok: true, draft });
  } catch { parentPort?.postMessage({ ok: false }); }
})();
