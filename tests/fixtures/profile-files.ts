// In-memory, synthetic import fixtures; no private resumes or PDF artifacts.
export function pdfFixture(lines = ['Skills', 'TypeScript and Node.js']): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td ${lines.map((s, i) => `${i ? '0 -16 Td ' : ''}(${s.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')} ET`;
  return pdfStream(stream);
}
export function positionedPdfFixture(items: {text: string; x: number; y: number}[]): Buffer {
  return pdfStream(items.map(({text,x,y}) => `BT /F1 10 Tf ${x} ${y} Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n'));
}
function pdfStream(stream: string): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(body); body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}
export function zipFixture(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name); const data = Buffer.from(text); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, filename, data); central.push(entry, filename); offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(directory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}
