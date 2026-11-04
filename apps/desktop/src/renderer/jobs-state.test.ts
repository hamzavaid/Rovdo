import { expect, it } from 'vitest';
import { presetKey, rankingLabel, initialJobSearch } from './jobs-state';
it('compares presets canonically without treating paging or saved-view switches as edits', () => {
  expect(presetKey(initialJobSearch)).toBe(
    presetKey({ ...initialJobSearch, offset: 20, savedOnly: true }),
  );
  expect(presetKey(initialJobSearch)).not.toBe(
    presetKey({ ...initialJobSearch, location: 'Remote' }),
  );
});
it('renames display labels without modifying immutable scoring configurations', () => {
  expect(rankingLabel({ id: 'builtin:legacy-v1', name: 'Legacy v1' })).toBe('Classic');
  expect(rankingLabel({ id: 'my-profile', name: 'My profile' })).toBe('My profile');
});
