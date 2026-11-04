import { expect, it } from 'vitest';
import { fingerprint, stable } from './scorer-v2';

it('keeps the published 64-bit fingerprint identical for Unicode and large evidence', () => {
  for (const value of [
    null,
    'Résumé 🦉',
    { b: [2, 1], a: 'x' },
    Array.from({ length: 220 }, (_, i) => ({ id: i, excerpt: 'verified evidence '.repeat(10) })),
  ]) {
    let expected = 14695981039346656037n;
    for (const c of stable(value))
      expected = BigInt.asUintN(64, (expected ^ BigInt(c.charCodeAt(0))) * 1099511628211n);
    expect(fingerprint(value)).toBe(expected.toString(16).padStart(16, '0'));
  }
});
