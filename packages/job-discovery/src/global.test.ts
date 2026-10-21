import { expect, it } from 'vitest';
import { BOARD_REGISTRY } from '@rovdo/job-sources';
import { discoveryQueries } from './queries';
import { sampleCandidate } from '../../../tests/fixtures/ranking-v2';
import { JobSearchSchema } from '@rovdo/shared';
it('catalogs all 126 boards without pretending indexed/blocked entries have scrapers', () => {
  expect(BOARD_REGISTRY).toHaveLength(126);
  expect(new Set(BOARD_REGISTRY.map((s) => s.id)).size).toBe(126);
  expect(BOARD_REGISTRY.find((s) => s.name === 'LinkedIn Jobs')).toMatchObject({
    mode: 'scraper',
    status: 'blocked',
  });
  expect(BOARD_REGISTRY.find((s) => s.name === 'Greenhouse')?.adapter).toBe('ats');
});
it('builds stable private qualification-driven queries without contacts, legal assertions or unverified skills', () => {
  const p = sampleCandidate(['typescript', 'verilog']);
  p.preferences.roles = ['Firmware Engineer'];
  p.facts.push({
    id: 'email',
    field: 'email',
    value: 'secret@example.com',
    verified: true,
    source: { kind: 'user', reference: 'Contact', capturedAt: '2026-10-21T00:00:00.000Z' },
  });
  const q = discoveryQueries(p);
  expect(q.length).toBeGreaterThan(3);
  expect(q.join(' ')).toMatch(/Verilog/);
  expect(q.join(' ')).not.toContain('secret@example.com');
  expect(discoveryQueries(p)).toEqual(q);
  p.intelligence!.skills[1]!.verified = false;
  p.intelligence!.experience.forEach((q) => (q.skills = q.skills.filter((s) => s !== 'verilog')));
  p.intelligence!.projects.forEach((q) => (q.skills = q.skills.filter((s) => s !== 'verilog')));
  expect(discoveryQueries(p).join(' ')).not.toContain('Verilog');
});
it('keeps old search configurations readable and distinguishes all three scopes', () => {
  const old = { query: '', company: '', workMode: 'all', savedOnly: false, includeExcluded: false };
  expect(JobSearchSchema.parse(old).scope).toBeUndefined();
  for (const scope of ['global', 'saved-companies', 'company'])
    expect(JobSearchSchema.parse({ ...old, scope }).scope).toBe(scope);
});
