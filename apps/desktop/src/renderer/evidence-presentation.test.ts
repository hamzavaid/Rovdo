import { expect, it } from 'vitest';
import { evidenceText } from './evidence-presentation';
it('shows a human source reference while preserving ordinary source excerpts verbatim', () => {
  expect(
    evidenceText(
      '{"qualification":{"id":"internal","name":"Controller"},"reference":"My repository and bench notes"}',
    ),
  ).toBe('My repository and bench notes');
  expect(
    evidenceText(
      '{"userConfirmed":{"id":"internal","evidenceIds":["e"],"verified":false,"name":"Controller","skills":["cpp"],"start":null}}',
    ),
  ).toBe('User-confirmed qualification: Name: Controller; Associated skills: cpp');
  expect(evidenceText('Built a controller using C++.')).toBe('Built a controller using C++.');
});
