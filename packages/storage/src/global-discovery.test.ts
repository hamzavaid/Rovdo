import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { randomUUID } from 'node:crypto';
it('persists resumable queues and makes task and discovery membership insertion idempotent', () => {
  const store = new CareerStore(':memory:');
  try {
    const id = randomUUID();
    const run = {
      id,
      status: 'running' as const,
      createdAt: 1,
      updatedAt: 1,
      profileVersion: null,
      queries: ['TypeScript jobs'],
      options: { sourceIds: ['himalayas'], overrides: {} },
      reason: null,
    };
    store.global.saveRun(run);
    const task = {
      id: 'task',
      runId: id,
      sourceId: 'himalayas',
      kind: 'provider' as const,
      payload: { page: 1 },
      status: 'pending' as const,
      nextAt: 0,
      attempts: 0,
      error: null,
      priority: 0,
    };
    store.global.enqueue(task);
    store.global.enqueue(task);
    expect(store.global.ready(id, 1)).toHaveLength(1);
    store.global.saveTask({ ...task, status: 'running' });
    store.global.recover();
    expect(store.global.run(id).status).toBe('paused');
    expect(store.global.ready(id, 1)).toHaveLength(1);
    expect(store.global.stats(id).pending).toBe(1);
  } finally {
    store.close();
  }
});
