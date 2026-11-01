import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { RuntimeStore } from './runtime';
import { DiscoveryStore } from './discovery';
it('enforces runtime event parent relationships on its own connection', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const db = (store as unknown as { db: DatabaseSync }).db;
    expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1);
    expect(() =>
      db.prepare('INSERT INTO browser_event VALUES(?,?,?)').run('missing', 1, '{}'),
    ).toThrow();
  } finally {
    store.close();
  }
});
it('cleans expired caches in bounded batches without touching durable records or live entries', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new DiscoveryStore(db);
    for (let i = 0; i < 12; i++) {
      store.fail(`expired:${i}`, 'HTTP_429', 5);
      store.putCache(
        `https://example.com/${i}`,
        { status: 200, headers: {}, body: 'fixture', capturedAt: 1 },
        5,
      );
    }
    store.fail('live', 'HTTP_429', 100);
    store.putCache(
      'https://example.com/live',
      { status: 200, headers: {}, body: 'live', capturedAt: 1 },
      100,
    );
    expect(store.cleanupExpired(10, 4)).toEqual({ responses: 4, failures: 4 });
    expect(db.prepare('SELECT count(*) AS n FROM discovery_response').get()!.n).toBe(9);
    expect(store.failure('live', 10)).toBe('HTTP_429');
    expect(store.cache('https://example.com/live', 10)?.body).toBe('live');
    expect(db.prepare('SELECT count(*) AS n FROM discovery_run').get()!.n).toBe(0);
  } finally {
    db.close();
  }
});
