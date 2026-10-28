import { expect, it } from 'vitest';
import { postingTimestamp } from './dates';
it('normalizes only explicit timestamps with bounded values and real calendar dates', () => {
  expect(postingTimestamp('2026-10-28')).toBe('2026-10-28T00:00:00.000Z');
  expect(postingTimestamp('2026-02-30T12:00:00Z')).toBeNull();
  expect(postingTimestamp('2026-10-28T12:00:00')).toBeNull();
  expect(postingTimestamp('10/28/26')).toBeNull();
  expect(postingTimestamp('Wed, 28 Oct 2026 08:30:00 GMT')).toBe('2026-10-28T08:30:00.000Z');
  expect(postingTimestamp('2026-10-28T02:00:00-07:00')).toBe('2026-10-28T09:00:00.000Z');
  expect(postingTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  expect(postingTimestamp(1793145600, 'seconds')).toBe('2026-10-28T00:00:00.000Z');
  for (const value of ['', null, undefined, Infinity, 1e99, '9999999999999999'])
    expect(postingTimestamp(value)).toBeNull();
});
