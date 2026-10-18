import { describe, expect, it } from 'vitest';
import { CareerStore } from './career';
describe('saved ranking configurations', () => {
  it('clones builtins, rejects invalid edits and preserves immutable revision history', () => {
    const store = new CareerStore(':memory:');
    try {
      const cloned = store.cloneRanking('builtin:technical-balanced', 'My technical profile');
      expect(store.rankings().find((p) => p.id === cloned.id)?.name).toBe('My technical profile');
      const changed = { ...cloned, name: 'Renamed', revision: 2, requiredMultiplier: 4 };
      store.saveRanking(changed); store.setDefaultRanking(changed.id); expect(store.defaultRanking()).toBe(changed.id);
      expect(() => store.saveRanking({ ...changed, revision: 3, weights: { ...changed.weights, skills: NaN } })).toThrow();
      expect(() => store.saveRanking({ ...changed, id: 'builtin:technical-balanced' })).toThrow();
      expect(() => store.saveRanking(changed)).toThrow();
      store.deleteRanking(changed.id); expect(store.defaultRanking()).toBe('builtin:legacy-v1');
      expect(store.rankings().some((p) => p.id === changed.id)).toBe(false);
      expect(() => store.deleteRanking('builtin:legacy-v1')).toThrow();
    } finally { store.close(); }
  });
});
