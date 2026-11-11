import { describe, expect, it } from 'vitest';
import { CollectionScopeSchema } from './index';

const scope = { version: 1, countries: ['US', 'CA'], origin: 'profile' };

describe('persistent collection scope boundary', () => {
  it('accepts multiple collection countries independently of a view query', () => {
    expect(CollectionScopeSchema.parse(scope)).toEqual(scope);
    expect(CollectionScopeSchema.parse({ ...scope, origin: 'user' }).origin).toBe('user');
  });

  it.each([
    { version: 2 },
    { countries: [] },
    { countries: ['US', 'US'] },
    { countries: ['us'] },
    { countries: ['USA'] },
    { countries: ['ZZ'] },
    { origin: 'geolocation' },
    { query: 'Software Engineer' },
  ])('rejects malformed scope or view-only input: %j', (override) => {
    expect(CollectionScopeSchema.safeParse({ ...scope, ...override }).success).toBe(false);
  });
});
