import { inflateRawSync } from 'node:zlib';

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
    if (!/^(?:word\/(?:document\.xml|styles\.xml|_rels\/document\.xml\.rels)|(?:[^/]+\/)*(?:Profile|Positions|Education|Skills|Projects|Certifications)\.csv)$/i.test(name)) continue;
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
