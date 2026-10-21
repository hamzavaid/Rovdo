/** Local job interoperability only: no renderer networking, scraping, or private candidate export. */
export function* parseJobRows(
  text: string,
  format: 'csv' | 'json',
): Generator<Record<string, unknown>> {
  if (text.length > 5_000_000)
    throw new Error('Use a file under 5 MB; split larger exports into batches.');
  if (format === 'json') {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) throw new Error('Expected an array of exported job rows.');
    for (const row of raw) {
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw new Error('Each job must be an object.');
      yield row as Record<string, unknown>;
    }
    return;
  }
  let row: string[] = [],
    value = '',
    quoted = false;
  let header: string[] | null = null;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === undefined)) {
      row.push(value.replace(/\r$/, ''));
      value = '';
      if (c !== ',') {
        if (row.some(Boolean)) {
          if (!header) {
            header = row.map((h) => h.replace(/^\uFEFF/, '').trim());
            if (new Set(header).size !== header.length)
              throw new Error('CSV has duplicate column names.');
          } else yield Object.fromEntries(header.map((h, k) => [h, row[k] ?? '']));
        }
        row = [];
      }
    } else if (c !== undefined) value += c;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
}
export { exportJobs } from '@rovdo/career';
