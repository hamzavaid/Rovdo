/**
 * Typed import/model/source failures and safe, actionable UI messages.
 * Unknown exception details are collapsed to allow-listed errors rather than leaking paths or document content.
 */
import { z } from 'zod';
export const ImportFailureCodeSchema = z.enum([
  'UNSUPPORTED_FILE',
  'TRANSCRIPT_UNRECOGNIZED',
  'SCANNED_PDF',
  'EMPTY_DOCUMENT',
  'MALFORMED_DOCUMENT',
  'DOCUMENT_LIMIT',
  'FILE_UNREADABLE',
  'IMPORT_TIMEOUT',
  'IMPORT_CANCELED',
  'IMPORT_VALIDATION',
  'IMPORT_CONFLICT',
  'REVIEW_REQUIRED',
  'SOURCE_UNAVAILABLE',
  'SOURCE_RATE_LIMITED',
  'MODEL_CONFIGURATION',
  'MODEL_FAILED',
  'MODEL_RESPONSE_INVALID',
  'MODEL_TIMEOUT',
  'MODEL_RATE_LIMITED',
  'MODEL_BUDGET',
  'IMPORT_FAILED',
]);
export type ImportFailureCode = z.infer<typeof ImportFailureCodeSchema>;
export const IMPORT_FAILURE_MESSAGES: Record<ImportFailureCode, string> = {
  TRANSCRIPT_UNRECOGNIZED:
    'No course table could be identified reliably. Use a text-based transcript with Course Code and Course Title columns, or add coursework manually.',
  UNSUPPORTED_FILE: 'Choose a supported PDF, DOCX, TXT, Markdown, JSON or LinkedIn CSV/ZIP file.',
  SCANNED_PDF:
    'This PDF has no readable text. Export a text-based PDF or paste its text; OCR is not available.',
  EMPTY_DOCUMENT:
    'No profile text was found. Choose a document with text or paste your qualifications.',
  MALFORMED_DOCUMENT:
    'The document is damaged or malformed. Re-export it from its original application and try again.',
  DOCUMENT_LIMIT:
    'This document exceeds the file, text or archive processing limits. Use a smaller supported document.',
  FILE_UNREADABLE:
    'The selected file cannot be read. Check that it exists and that Rovdo can access it.',
  IMPORT_TIMEOUT:
    'Document processing timed out. Try a smaller or simpler document, or paste its text.',
  IMPORT_CANCELED: 'Import canceled. Your saved profile is unchanged.',
  IMPORT_VALIDATION:
    'Some proposed fields are invalid. Check dates, required values and evidence references.',
  IMPORT_CONFLICT:
    'Resolve conflicting selections, or refresh if this import was already reviewed or the profile changed. Select one consistent version of a qualification.',
  REVIEW_REQUIRED:
    'Individually review employment, education, certifications and conflicting qualifications before verifying them.',
  SOURCE_UNAVAILABLE: 'The public source is unavailable. Retry later or use a local profile file.',
  SOURCE_RATE_LIMITED: 'The public source is rate limited. Wait before retrying.',
  MODEL_CONFIGURATION:
    'Check the selected model, credentials and pricing in Models & Privacy. Deterministic review remains available.',
  MODEL_FAILED:
    'The model request failed. Check the provider connection or continue deterministic review.',
  MODEL_RESPONSE_INVALID:
    'The model suggestions could not be validated against the source. Retry or continue deterministic review.',
  MODEL_TIMEOUT: 'The model request timed out. Retry or continue deterministic review.',
  MODEL_RATE_LIMITED: 'The model provider is rate limited. Wait or continue deterministic review.',
  MODEL_BUDGET:
    'This request exceeds the approved spend limit or cannot be fully priced. Review pricing and the spend limit.',
  IMPORT_FAILED:
    'Import could not be completed. Retry with a supported file or paste its text. Your saved profile is unchanged.',
};
const generalMessages: Record<string, string> = {
  VALIDATION_ERROR: 'Check the request fields and review approvals.',
  IPC_FORBIDDEN: 'This action is unavailable from this window.',
  BUSY: 'Another action is in progress. Wait for it to finish.',
};
export const importFailureMessage = (code: string): string =>
  IMPORT_FAILURE_MESSAGES[code as ImportFailureCode] ??
  generalMessages[code] ??
  IMPORT_FAILURE_MESSAGES.IMPORT_FAILED;
export class ImportFailure extends Error {
  constructor(readonly code: ImportFailureCode) {
    super(importFailureMessage(code));
    this.name = 'ImportFailure';
  }
}
/** Return only allow-listed codes; never surface paths, prompts, keys or parser exception text. */
export function importFailureCode(
  error: unknown,
  phase: 'document' | 'model' | 'source' = 'document',
): ImportFailureCode {
  if (error instanceof ImportFailure) return error.code;
  const message = error instanceof Error ? error.message : '';
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : message;
  const known = ImportFailureCodeSchema.safeParse(code);
  if (known.success) return known.data;
  if (/ABORT|AbortError|CANCELED/i.test(code)) return 'IMPORT_CANCELED';
  if (phase === 'model') {
    if (/TIMEOUT|TimeoutError|timed out/.test(code)) return 'MODEL_TIMEOUT';
    if (/RATE_LIMITED/.test(code)) return 'MODEL_RATE_LIMITED';
    if (/BUDGET|ACCOUNTING/.test(code)) return 'MODEL_BUDGET';
    if (/PRICING|KEY_REQUIRED|PROFILE_NOT_FOUND/.test(code)) return 'MODEL_CONFIGURATION';
    return 'MODEL_FAILED';
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'IMPORT_VALIDATION';
  if (/PDF_TIMEOUT|TIMEOUT/.test(code)) return 'IMPORT_TIMEOUT';
  if (/ABORT|AbortError|CANCELED/i.test(code)) return 'IMPORT_CANCELED';
  if (/GITHUB_RATE|GITHUB_COOLDOWN/.test(code)) return 'SOURCE_RATE_LIMITED';
  if (phase === 'source' || /GITHUB_UNAVAILABLE/.test(code)) return 'SOURCE_UNAVAILABLE';
  if (/UNSUPPORTED_FILE|NO_LINKEDIN/.test(code)) return 'UNSUPPORTED_FILE';
  if (/SCANNED_PDF/.test(code)) return 'SCANNED_PDF';
  if (/FILE_LIMIT|TEXT_LIMIT|ARCHIVE_LIMIT|XML_LIMIT|CSV_LIMIT|PDF_LIMIT/.test(code))
    return 'DOCUMENT_LIMIT';
  if (/INVALID_|PDF_PARSE_FAILED|UNSUPPORTED_ARCHIVE/.test(code)) return 'MALFORMED_DOCUMENT';
  if (/IMPORT_ALREADY_REVIEWED|IMPORT_VERSION_CONFLICT/.test(code)) return 'IMPORT_CONFLICT';
  return 'IMPORT_FAILED';
}
