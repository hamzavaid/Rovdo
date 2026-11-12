import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { installStarterDirectory } from '@rovdo/job-sources';
import type { StarterDirectoryManifest } from '@rovdo/shared';
const manifest = (count = 3, releasedAt = '2026-11-11T00:00:00Z'): StarterDirectoryManifest => ({
  version: 1,
  releasedAt,
  employers: Array.from({ length: count }, (_, i) => ({
    id: `fixture-${String(i).padStart(5, '0')}`,
    name: `Employer ${i}`,
    aliases: [`Alias ${i}`],
    categories: ['manufacturing', 'finance'],
    referenceSets: [{ id: 'broader', edition: '2026-11' }],
    boards: [{ url: `https://jobs.lever.co/fixture-${i}`, adapter: 'lever' }],
    provenance: [{ url: 'https://example.com/companies', checkedAt: '2026-11-11T00:00:00Z' }],
  })),
});
it('installs idempotently, preserves opt-outs and historical release rows across upgrades', async () => {
  const store = new CareerStore(':memory:');
  const first = manifest();
  try {
    await installStarterDirectory(first, store);
    expect(store.starterDirectoryPage({}).total).toBe(3);
    const key = 'lever:fixture-0:global';
    store.global.configureBoard(key, 'disable');
    await installStarterDirectory(first, store);
    expect(store.global.board(key)?.enabled).toBe(false);
    const second = manifest(4, '2026-11-12T00:00:00Z');
    await installStarterDirectory(second, store);
    await installStarterDirectory(first, store);
    expect(store.starterDirectoryPage({}).total).toBe(4);
    expect(store.global.board(key)?.enabled).toBe(false);
    expect(store.global.board(key)?.lastSuccess).toBeNull();
    expect(store.sources()).toHaveLength(0);
    expect(store.companyIdentity('Alias 0')).toBe('fixture-00000');
  } finally {
    store.close();
  }
});
it('uses bounded keyset batches, yields between batches and resumes an interrupted install', async () => {
  const store = new CareerStore(':memory:');
  const input = manifest(1201);
  let batches = 0,
    yielded = false;
  try {
    await expect(
      installStarterDirectory(input, store, {
        batchSize: 25,
        yieldTurn: async () => {
          batches++;
          if (batches === 4) throw new Error('Interrupted');
        },
      }),
    ).rejects.toThrow('Interrupted');
    const count = store.starterDirectoryPage({}).total;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(100);
    const timer = new Promise<void>((resolve) =>
      setImmediate(() => {
        yielded = true;
        resolve();
      }),
    );
    await installStarterDirectory(input, store, { batchSize: 25 });
    await timer;
    expect(yielded).toBe(true);
    expect(store.starterDirectoryPage({}).total).toBe(1201);
    expect(store.global.companyPage({}).total).toBe(1201);
  } finally {
    store.close();
  }
});
it('keeps unsupported boards visible without granting collection or inventing live verification', async () => {
  const store = new CareerStore(':memory:');
  const input = manifest(1);
  input.employers[0]!.boards = [{ url: 'https://careers.example.com/jobs', adapter: 'workday' }];
  try {
    await installStarterDirectory(input, store);
    expect(store.starterDirectoryPage({}).rows[0]?.boards[0]?.adapter).toBe('workday');
    expect(store.global.companyPage({}).enabled).toBe(0);
    expect(store.sources()).toHaveLength(0);
    expect(store.jobs()).toHaveLength(0);
  } finally {
    store.close();
  }
});

it('resumes after a database reopen and rejects changing an already checkpointed release', async () => {
  const directory = resolve(mkdtempSync(join(tmpdir(), 'rovdo-starter-install-')));
  if (
    !directory.startsWith(resolve(tmpdir()) + sep) ||
    !basename(directory).startsWith('rovdo-starter-install-')
  )
    throw new Error('Unsafe cleanup');
  const file = join(directory, 'career.sqlite');
  let store = new CareerStore(file);
  const input = manifest(101);
  let yields = 0;
  try {
    await expect(
      installStarterDirectory(input, store, {
        batchSize: 25,
        yieldTurn: async () => {
          if (++yields === 3) throw new Error('Interrupted');
        },
      }),
    ).rejects.toThrow('Interrupted');
    const partial = store.starterDirectoryPage({}).total;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(101);
    store.close();
    store = new CareerStore(file);
    await installStarterDirectory(input, store);
    expect(store.starterDirectoryPage({}).total).toBe(101);
    const changed = structuredClone(input);
    changed.employers[0]!.name = 'Unexpected edit';
    await expect(installStarterDirectory(changed, store)).rejects.toThrow(
      'DIRECTORY_RELEASE_IMMUTABLE',
    );
    expect(store.starterDirectoryPage({ query: 'Unexpected edit' }).total).toBe(0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('orders releases chronologically when ISO timestamps use different fractional precision', async () => {
  const store = new CareerStore(':memory:');
  const earlier = manifest(1, '2026-11-11T00:00:00Z');
  const later = manifest(1, '2026-11-11T00:00:00.100Z');
  later.employers[0]!.name = 'Updated employer name';
  try {
    await installStarterDirectory(earlier, store);
    await installStarterDirectory(later, store);
    expect(store.starterDirectoryPage({}).rows[0]?.name).toBe('Updated employer name');
    await installStarterDirectory(earlier, store);
    expect(store.starterDirectoryPage({}).rows[0]?.name).toBe('Updated employer name');
  } finally {
    store.close();
  }
});
