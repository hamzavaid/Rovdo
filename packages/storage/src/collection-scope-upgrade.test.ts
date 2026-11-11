import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CareerStore } from './career';
import { sampleCandidate, sampleJob } from '../../../tests/fixtures/ranking-v2';

const userScope = { version: 1 as const, countries: ['US'], origin: 'user' as const };

describe('collection scope persistence upgrade', () => {
  it('starts without a scope and assigns the first saved scope revision one', () => {
    const store = new CareerStore(':memory:');
    try {
      expect(store.collectionScope()).toBeNull();
      expect(store.saveCollectionScope(userScope)).toEqual({ scope: userScope, revision: 1 });
      expect(store.collectionScope()).toEqual({ scope: userScope, revision: 1 });
    } finally {
      store.close();
    }
  });

  it('does not increment revisions for identical scopes or reordered country sets', () => {
    const store = new CareerStore(':memory:');
    try {
      store.saveCollectionScope(userScope);
      expect(store.saveCollectionScope(userScope).revision).toBe(1);
      const expanded = { ...userScope, countries: ['US', 'CA'] };
      expect(store.saveCollectionScope(expanded).revision).toBe(2);
      const reordered = store.saveCollectionScope({ ...expanded, countries: ['CA', 'US'] });
      expect(reordered.revision).toBe(2);
      expect([...reordered.scope.countries].sort()).toEqual(['CA', 'US']);
      expect(store.saveCollectionScope(userScope).revision).toBe(3);
    } finally {
      store.close();
    }
  });

  it('persists scope and revision across a real database close and reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rovdo-scope-upgrade-'));
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith('rovdo-scope-upgrade-')
    ) {
      throw new Error('Unsafe cleanup');
    }
    const file = join(directory, 'career.sqlite');
    let store: CareerStore | undefined;
    try {
      store = new CareerStore(file);
      store.saveCollectionScope(userScope);
      store.saveCollectionScope({ ...userScope, countries: ['CA'] });
      store.close();
      store = undefined;
      store = new CareerStore(file);
      expect(store.collectionScope()).toEqual({
        scope: { ...userScope, countries: ['CA'] },
        revision: 2,
      });
    } finally {
      store?.close();
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('preserves collected jobs, sources and profiles when scope changes or profiles are saved', () => {
    const store = new CareerStore(':memory:');
    try {
      const candidate = { ...sampleCandidate(), version: 1 };
      candidate.preferences.locations = ['United States'];
      store.saveProfile(candidate);
      const source = store.globalSource(
        'scope-fixture',
        'Synthetic Employer',
        'https://jobs.example.com/scope',
      );
      const job = {
        ...sampleJob(),
        location: 'Toronto, Canada',
        provenance: [
          {
            sourceId: source.id,
            sourceKey: '1',
            url: 'https://jobs.example.com/1',
            collectedAt: 100,
            rawSha256: 'b'.repeat(64),
            fields: {},
          },
        ],
      };
      store.batch(source, [job], store.sources()[0]!.state, 'initial-poll', true, 100);
      const jobsBefore = store.jobs();
      const sourcesBefore = store.sources();
      store.saveCollectionScope({ ...userScope, countries: ['CA'] });
      store.saveCollectionScope(userScope);
      expect(store.jobs()).toEqual(jobsBefore);
      expect(store.job(job.id).activeStatus).toBe('open');
      expect(store.sources()).toEqual(sourcesBefore);
      expect(store.profile()).toEqual(candidate);
      const changedProfile = {
        ...candidate,
        version: 2,
        preferences: { ...candidate.preferences, locations: ['Germany'] },
      };
      store.saveProfile(changedProfile);
      expect(store.profile()).toEqual(changedProfile);
      expect(store.collectionScope()).toEqual({ scope: userScope, revision: 2 });
      expect(store.jobs()).toEqual(jobsBefore);
    } finally {
      store.close();
    }
  });
});
