import { expect, it } from 'vitest';
import { createActionGate } from './action-state';
it('blocks duplicate actions synchronously and releases the gate on failure', async () => {
  const gate = createActionGate();
  let complete!: () => void;
  let calls = 0;
  const first = gate.run(async () => {
    calls++;
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
  });
  expect(
    await gate.run(async () => {
      calls++;
    }),
  ).toBe(false);
  expect(calls).toBe(1);
  complete();
  expect(await first).toBe(true);
  await expect(
    gate.run(async () => {
      throw new Error('fixture');
    }),
  ).rejects.toThrow('fixture');
  expect(
    await gate.run(async () => {
      calls++;
    }),
  ).toBe(true);
  expect(calls).toBe(2);
});
