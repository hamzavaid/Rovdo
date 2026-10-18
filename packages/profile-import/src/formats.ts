import { inflateRawSync } from 'node:zlib';
import PDFParser from 'pdf2json';

export function zipEntries(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length > 5_000_000) throw new Error('FILE_TOO_LARGE');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0 || buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6)) throw new Error('UNSUPPORTED_ARCHIVE');
  const count = buffer.readUInt16LE(eocd + 10); let offset = buffer.readUInt32LE(eocd + 16); let total = 0;
  if (count > 500) throw new Error('ARCHIVE_LIMIT');
  const result = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('INVALID_ARCHIVE');
    const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10); const size = buffer.readUInt32LE(offset + 24); const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28); const extra = buffer.readUInt16LE(offset + 30); const comment = buffer.readUInt16LE(offset + 32); const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); offset += 46 + nameLength + extra + comment;
    total += size;
    if (flags & 1 || ![0, 8].includes(method) || size > 5_000_000 || total > 20_000_000 || size > Math.max(100000, compressed * 200) || local + 30 > buffer.length) throw new Error('ARCHIVE_LIMIT');
    if (!/^(?:word\/document\.xml|(?:[^/]+\/)*(?:Profile|Positions|Education|Skills|Projects|Certifications)\.csv)$/i.test(name)) continue;
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('INVALID_ARCHIVE');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new Error('INVALID_ARCHIVE');
    const data = buffer.subarray(start, start + compressed);
    const decoded = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.min(5_000_000, size + 1) });
    if (decoded.length !== size || result.has(name)) throw new Error('INVALID_ARCHIVE');
    result.set(name, decoded);
  }
  return result;
}
function entities(text: string): string { return text.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, (m) => { if (m.startsWith('&#')) { const n = m[2]!.toLowerCase() === 'x' ? parseInt(m.slice(3, -1), 16) : Number(m.slice(2, -1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; } return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[m.toLowerCase()] ?? ''; }); }
export function csvRows(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quote = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quote && text[i + 1] === '"') { value += '"'; i++; } else quote = !quote; }
    else if (!quote && (c === ',' || c === '\n' || c === undefined)) { row.push(value.replace(/\r$/, '')); value = ''; if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; } }
    else if (c !== undefined) value += c;
    if (rows.length > 1000 || value.length > 100000) throw new Error('CSV_LIMIT');
  }
  if (quote) throw new Error('INVALID_CSV');
  const header = rows.shift()?.map((h) => h.replace(/^\uFEFF/, '').trim()) ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
function linkedInCsv(name: string, text: string): string {
  const kind = /([^/]+)\.csv$/i.exec(name)?.[1] ?? 'Profile';
  return kind + '\n' + csvRows(text).map((r) => {
    if (/Positions/i.test(kind)) return `${r.Title ?? ''} | ${r['Company Name'] ?? ''} | ${r['Started On'] ?? ''} - ${r['Finished On'] || 'Present'}\n${r.Description ?? ''}`;
    if (/Skills/i.test(kind)) return r.Name ?? '';
    if (/Education/i.test(kind)) return `${r['Degree Name'] ?? ''} | ${r['School Name'] ?? ''} | ${r['End Date'] ?? ''}`;
    if (/Projects/i.test(kind)) return `Project: ${r.Title ?? r.Name ?? ''} | ${r.Description ?? ''}`;
    if (/Certifications/i.test(kind)) return `${r.Name ?? ''} | ${r.Authority ?? ''} | ${r['Finished On'] ?? ''}`;
    return r.Summary ?? r.Headline ?? '';
  }).join('\n');
}
export async function extractFileText(format: string, buffer: Buffer): Promise<string> {
  if (!buffer.length || buffer.length > 5_000_000) throw new Error('FILE_LIMIT');
  let result: string;
  if (format === 'pdf') {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('INVALID_PDF');
    result = await new Promise<string>((resolve, reject) => {
      const parser = new PDFParser(null, true); const timer = setTimeout(() => reject(new Error('PDF_TIMEOUT')), 10000);
      parser.on('pdfParser_dataError', () => { clearTimeout(timer); reject(new Error('PDF_PARSE_FAILED')); });
      parser.on('pdfParser_dataReady', () => { clearTimeout(timer); try { resolve(parser.getRawTextContent()); } catch { reject(new Error('PDF_PARSE_FAILED')); } });
      // pdf2json expects an ArrayBuffer starting at byte zero. Node's small
      // Buffers may share a pool with a nonzero offset; pass an exact allocation.
      const exact = Buffer.alloc(buffer.length); buffer.copy(exact); parser.parseBuffer(exact, 0);
    });
  } else if (format === 'docx') {
    const xml = zipEntries(buffer).get('word/document.xml')?.toString('utf8'); if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('INVALID_DOCX');
    result = entities(xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n').replace(/<[^>]*>/g, ''));
  } else if (format === 'zip') {
    const entries = zipEntries(buffer); if (!entries.size) throw new Error('NO_LINKEDIN_CSV');
    result = [...entries].filter(([name]) => /\.csv$/i.test(name)).map(([name, data]) => linkedInCsv(name, data.toString('utf8'))).join('\n');
  } else if (format === 'csv') result = linkedInCsv('Positions.csv', buffer.toString('utf8'));
  else if (['txt', 'md', 'markdown', 'json'].includes(format)) result = buffer.toString('utf8').replace(/^\uFEFF/, '');
  else throw new Error('UNSUPPORTED_FILE');
  if (!result.trim() || result.length > 200000 || result.includes(String.fromCharCode(0))) throw new Error('TEXT_LIMIT_OR_SCANNED_PDF');
  return result.normalize('NFKC');
}
