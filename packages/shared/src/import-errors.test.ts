import { expect, it } from 'vitest';
import { importFailureCode, importFailureMessage } from './import-errors';
it.each([['UNSUPPORTED_FILE','UNSUPPORTED_FILE'],['SCANNED_PDF','SCANNED_PDF'],['PDF_TIMEOUT','IMPORT_TIMEOUT'],['INVALID_XML','MALFORMED_DOCUMENT'],['FILE_LIMIT','DOCUMENT_LIMIT']])('classifies %s without exposing raw errors', (raw,expected)=>{expect(importFailureCode(new Error(raw))).toBe(expected);expect(importFailureMessage(String(expected))).not.toContain(raw==='UNSUPPORTED_FILE'?'UNSUPPORTED_FILE':'private-path');});
it('does not leak unrecognized exception data into UI errors',()=>{const code=importFailureCode(new Error('C:/private/resume.pdf secret-canary'));expect(code).toBe('IMPORT_FAILED');expect(importFailureMessage(code)).not.toMatch(/secret-canary|private/);});
