import { expect, it } from 'vitest';
import { previewText } from './index';
import { assistancePayload, applyAssistance } from './assistance';
const p = previewText(
  'Skills\nTypeScript\nProjects\nController | Built Verilog modules.\nCitizenship: US\nGender: private',
  'resume',
  'file',
  '2026-10-19T00:00:00.000Z',
);
it('only transmits eligible untrusted source excerpts, not legal assertions or verified profile information', () => {
  const payload = assistancePayload(p);
  expect(JSON.stringify(payload)).not.toMatch(/Citizenship|Gender/);
  expect(JSON.stringify(payload)).toContain('Verilog');
});
it('accepts cited skill proposals as unverified suggestions and preserves the deterministic preview', () => {
  const e = p.intelligence.evidence.find((e) => e.excerpt.includes('Verilog'))!;
  const next = applyAssistance(p, {
    suggestions: [
      { op: 'skill', evidenceId: e.id, quote: 'Built Verilog modules.', value: 'Verilog' },
    ],
  });
  expect(next.intelligence.skills.find((s) => s.skillId === 'verilog')!.verified).toBe(false);
  expect(next.id).not.toBe(p.id);
  expect(p.warnings.join(' ')).not.toContain('AI-assisted');
});
it.each([
  { op: 'skill', evidenceId: 'invented', quote: 'PhD', value: 'Verilog' },
  { op: 'skill', evidenceId: p.intelligence.evidence[0]!.id, quote: 'TypeScript', value: 'FPGA' },
  {
    op: 'correct',
    section: 'skills',
    recordId: p.intelligence.skills[0]!.id,
    field: 'verified',
    value: 'true',
    evidenceId: p.intelligence.evidence[0]!.id,
    quote: 'TypeScript',
  },
  {
    op: 'skill',
    evidenceId: p.intelligence.evidence[0]!.id,
    quote: 'TypeScript',
    value: 'TypeScript',
    verified: true,
  },
])(
  'rejects unsupported credentials, invented evidence and verification authority: %j',
  (suggestion) => {
    expect(() => applyAssistance(p, { suggestions: [suggestion] })).toThrow();
  },
);
