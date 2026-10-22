/** Local transcript proposals: preserve explicit course rows, never infer employment, proficiency or degree completion. */
import { createHash } from 'node:crypto';
import { ImportPreviewSchema, ImportFailure } from '@rovdo/shared';
import type { ImportPreview } from '@rovdo/shared';
import { extractDocument, textDocument } from './document';
import type { ParsedDocument } from './document';
import { csvRows } from './formats';
import { parseDate } from './parser';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export async function transcriptDocument(format: string, bytes: Buffer): Promise<ParsedDocument> {
  if (format !== 'csv') return extractDocument(format, bytes, format === 'pdf');
  const rows = csvRows(bytes.toString('utf8'));
  if (!rows.length) throw new ImportFailure('EMPTY_DOCUMENT');
  const keys = Object.keys(rows[0]!);
  return textDocument(
    [keys.join(' | '), ...rows.map((r) => keys.map((k) => r[k] ?? '').join(' | '))].join('\n'),
    'csv',
  );
}
export function previewTranscript(doc: ParsedDocument, name: string, at: string): ImportPreview {
  const text = doc.blocks.map((b) => b.text).join('\n');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!text.trim()) throw new ImportFailure('EMPTY_DOCUMENT');
  const hash = sha(JSON.stringify(doc));
  const institution =
    lines.find(
      (l) => /\b(university|college|institute|polytechnic|school)\b/i.test(l) && !/[|\t]/.test(l),
    ) ?? '';
  const program =
    lines
      .find((l) => /^(?:degree(?: program)?|program(?:me)?|major|field of study)\s*:/i.test(l))
      ?.replace(/^[^:]+:\s*/, '') ?? '';
  const awarded = lines.find(
    (l) =>
      /^degree\s+(?:awarded|conferred)\s*:\s*\S/i.test(l) &&
      !/\b(?:none|not|pending|no|n\/?a|expected)\b/i.test(l.split(':').slice(1).join(':')),
  );
  const degree = awarded ?? program;
  const level = /\b(?:bachelor|b\.?s\.?|b\.?a\.?)\b/i.test(degree)
    ? 'bachelor'
    : /\b(?:master|m\.?s\.?|m\.?a\.?)\b/i.test(degree)
      ? 'master'
      : /doctor|ph\.?d/i.test(degree)
        ? 'doctorate'
        : /associate/i.test(degree)
          ? 'associate'
          : 'other';
  const courseRows: string[] = [];
  const excerpts: string[] = [];
  let headers: string[] | null = null;
  let malformed = 0;
  const split = (l: string) =>
    l
      .replace(/^\||\|$/g, '')
      .split(/\s*\|\s*|\t+|\s{2,}/)
      .map((x) => x.trim());
  const normalized = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  for (const line of lines) {
    const cells = split(line);
    const names = cells.map(normalized);
    if (
      names.some((n) => /^(coursetitle|coursename|description|title)$/.test(n)) &&
      names.some((n) => /^(coursecode|course|code|subject)$/.test(n))
    ) {
      headers = names;
      continue;
    }
    if (!headers || cells.length < 2) continue;
    const get = (pattern: RegExp) => cells[headers!.findIndex((n) => pattern.test(n))] ?? '';
    const code = get(/^(coursecode|course|code|subject)$/),
      title = get(/^(coursetitle|coursename|description|title)$/);
    if (!title || !/[a-z]/i.test(title) || !code || !/[A-Z].*\d/i.test(code)) {
      if (code && /\d/.test(code)) malformed++;
      continue;
    }
    const row = [
      code,
      title,
      get(/^(term|semester|session)$/),
      get(/^(credits|credit|units|hours)$/)
        ? get(/^(credits|credit|units|hours)$/) + ' credits'
        : '',
      get(/^(grade|result)$/),
    ]
      .filter(Boolean)
      .join(' / ');
    if (row.length > 500) {
      malformed++;
      continue;
    }
    if (!courseRows.includes(row)) {
      courseRows.push(row);
      excerpts.push(line);
    }
  }
  if (courseRows.length > 200) throw new ImportFailure('DOCUMENT_LIMIT');
  if (!courseRows.length) throw new ImportFailure('TRANSCRIPT_UNRECOGNIZED');
  const chunks: string[] = [];
  let excerpt = lines
    .slice(
      0,
      Math.max(
        0,
        lines.findIndex((l) => /course.*(?:title|name|description)/i.test(l)),
      ),
    )
    .join('\n')
    .slice(0, 2000);
  for (const line of excerpts) {
    if (excerpt.length + line.length > 3800) {
      chunks.push(excerpt);
      excerpt = '';
    }
    excerpt += (excerpt ? '\n' : '') + line;
  }
  if (excerpt) chunks.push(excerpt);
  const evidence = chunks.map((excerpt, i) => ({
    id: `transcript:${hash}:e${i}`,
    sourceId: 'source:' + hash,
    sourceKind: 'file' as const,
    excerpt,
    sha256: sha(excerpt),
    confidence: 0.9,
    verified: false,
    location: 'Transcript table / ' + (i + 1),
  }));
  const warnings = [
    ...doc.warnings,
    'Transcript records are proposals. Course grades do not establish professional proficiency, legal eligibility or degree completion.',
  ];
  if (!institution)
    warnings.push('No institution reliably identified; add it during individual review.');
  if (!awarded)
    warnings.push(
      'No explicit awarded-degree statement. Completion and graduation remain unconfirmed.',
    );
  if (malformed)
    warnings.push(
      `${malformed} ambiguous course rows were not converted; compare with the source.`,
    );
  return ImportPreviewSchema.parse({
    id: 'import:transcript:' + hash,
    parserVersion: 'profile-import-v2',
    status: 'ready',
    source: {
      id: 'source:' + hash,
      name,
      kind: 'file',
      format: 'transcript-' + doc.format,
      sha256: hash,
      capturedAt: at,
    },
    facts: [],
    warnings,
    intelligence: {
      schemaVersion: 'intelligence-v2',
      evidence,
      skills: [],
      experience: [],
      projects: [],
      certifications: [],
      education: [
        {
          id: 'transcript:' + hash,
          evidenceIds: evidence.map((e) => e.id),
          verified: false,
          institution,
          field: program,
          level,
          status: awarded ? 'completed' : 'incomplete',
          graduation: awarded
            ? parseDate(
                lines.find((l) => /^(?:date (?:awarded|conferred)|graduation date)\s*:/i.test(l)) ??
                  '',
              )
            : null,
          coursework: courseRows,
        },
      ],
    },
  });
}
