import { describe, expect, it } from 'vitest';
import { createLogger } from './index';

describe('metadata-only diagnostics', () => {
  it('writes a timestamped, structured event', () => {
    const lines: string[] = [];
    const logger = createLogger(
      (line) => lines.push(line),
      () => new Date('2026-10-15T12:00:00Z'),
    );
    logger({ level: 'info', event: 'app.started', component: 'main' });
    expect(JSON.parse(lines[0]!)).toEqual({
      timestamp: '2026-10-15T12:00:00.000Z',
      level: 'info',
      event: 'app.started',
      component: 'main',
    });
  });

  it.each([
    { apiKey: 'secret-canary' },
    { password: 'secret-canary' },
    { nested: { Authorization: 'Bearer secret-canary' } },
    { message: 'Candidate Person secret-canary' },
    { error: new Error('secret-canary') },
    { event: 'secret-canary' },
    { runId: 'secret-canary' },
    { component: 'secret-canary' },
  ])('never serializes unapproved fields or free text: %j', (extra) => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line))({
      level: 'error',
      event: 'ipc.rejected',
      component: 'main',
      ...extra,
    });
    expect(lines).toHaveLength(1);
    expect(lines.join('')).not.toContain('secret-canary');
    expect(JSON.parse(lines[0]!).event).toBe('diagnostics.rejected');
  });

  it('accepts fixed error codes and UUID run identifiers', () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line))({
      level: 'warn',
      event: 'ipc.rejected',
      component: 'main',
      errorCode: 'IPC_FORBIDDEN',
      runId: 'd8a0e7ae-9acf-4d48-ab80-ce48ae3de3a5',
    });
    expect(JSON.parse(lines[0]!).errorCode).toBe('IPC_FORBIDDEN');
  });
});
