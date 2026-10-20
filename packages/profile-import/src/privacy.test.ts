import { expect, it } from 'vitest';
import { importAssistancePayload } from '@rovdo/shared';
import { applyAssistance } from './assistance';
import { previewText } from './index';
it('redacts detected contact details by default and limits record fields', () => {
  const p = previewText(
    'Skills\nTypeScript\nProjects\nController | Contact: anon@example.com, +1 (415) 555-0123. Built TypeScript modules.',
    'x',
    'file',
    '2026-10-20T00:00:00.000Z',
  );
  const data = JSON.stringify(importAssistancePayload(p));
  expect(data).not.toMatch(/anon@example.com|555-0123|roleFamily|production|proficiency/);
  expect(data).toContain('TypeScript');
});
it('supports explicit source selection and an opt-out from contact redaction', () => {
  const p = previewText(
    'Skills\nTypeScript\nProjects\nController | anon@example.com',
    'x',
    'file',
    '2026-10-20T00:00:00.000Z',
  );
  const ids = p.intelligence.skills[0]!.evidenceIds.slice(0, 1);
  expect(
    importAssistancePayload(p, { evidenceIds: ids }).evidence.every((e) => ids.includes(e.id)),
  ).toBe(true);
  expect(JSON.stringify(importAssistancePayload(p, { redactPii: false }))).toContain(
    'anon@example.com',
  );
  expect(importAssistancePayload(p, { evidenceIds: [] }).evidence).toHaveLength(0);
});

it('never accepts AI citations to excluded sources or redaction markers', () => {
  const p = previewText(
    'Skills\nTypeScript\nProjects\nController | anon@example.com built Verilog modules.',
    'x',
    'file',
    '2026-10-20T00:00:00.000Z',
  );
  const e = p.intelligence.evidence.find((e) => e.excerpt.includes('Verilog'))!;
  expect(() =>
    applyAssistance(
      p,
      { suggestions: [{ op: 'skill', evidenceId: e.id, quote: 'Verilog', value: 'Verilog' }] },
      { evidenceIds: [] },
    ),
  ).toThrow();
  expect(() =>
    applyAssistance(p, {
      suggestions: [
        {
          op: 'correct',
          section: 'projects',
          recordId: p.intelligence.projects[0]!.id,
          field: 'description',
          evidenceId: e.id,
          quote: '[redacted email]',
          value: '[redacted email]',
        },
      ],
    }),
  ).toThrow();
});
