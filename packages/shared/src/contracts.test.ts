import { describe, expect, it } from 'vitest';
import { AppInfoSchema, EmptyRequestSchema, RunStateSchema, StartRunSchema } from './index';

const validRun = {
  task: 'Review a fixture application',
  workflow: 'career',
  modelProfileId: 'test-profile',
  maxSteps: 20,
  maxUsd: 2,
  allowedOrigins: ['https://jobs.example.com'],
  applicationLimit: 1,
  submitMode: 'approve-each',
};

describe('run request boundary', () => {
  it('accepts an explicit bounded request', () => {
    expect(StartRunSchema.parse(validRun)).toEqual(validRun);
  });

  it.each([
    { maxSteps: 0 },
    { maxSteps: 1.5 },
    { maxUsd: -1 },
    { maxUsd: Infinity },
    { applicationLimit: -1 },
    { applicationLimit: 0.5 },
    { task: '   ' },
    { workflow: 'shell' },
    { submitMode: 'automatic' },
    { modelProfileId: '' },
    { apiKey: 'secret-canary' },
    { allowedOrigins: [] },
  ])('rejects unsafe or incomplete input: %j', (override) => {
    expect(StartRunSchema.safeParse({ ...validRun, ...override }).success).toBe(false);
  });

  it.each([
    'http://jobs.example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@jobs.example.com',
    'https://jobs.example.com/form',
    'https://jobs.example.com?token=secret',
    'https://jobs.example.com#secret',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://169.254.169.254',
    'https://192.168.1.2',
  ])('rejects an invalid external origin: %s', (origin) => {
    expect(StartRunSchema.safeParse({ ...validRun, allowedOrigins: [origin] }).success).toBe(false);
  });

  it('supports a zero-spend, review-only request', () => {
    expect(
      StartRunSchema.safeParse({
        ...validRun,
        maxUsd: 0,
        applicationLimit: 0,
        submitMode: 'review-only',
      }).success,
    ).toBe(true);
  });

  it('enumerates state names without implementing the later runtime', () => {
    for (const state of [
      'CREATED',
      'QUEUED',
      'PREFLIGHT',
      'PLANNING',
      'EXECUTING',
      'VERIFYING',
      'AWAITING_APPROVAL',
      'PAUSED',
      'RETRYING',
      'COMPLETED',
      'PARTIAL',
      'FAILED',
      'CANCELED',
    ]) {
      expect(RunStateSchema.safeParse(state).success).toBe(true);
    }
    expect(RunStateSchema.safeParse('SUBMITTED').success).toBe(false);
  });
});

describe('read-only desktop IPC contracts', () => {
  it('accepts only an empty request', () => {
    expect(EmptyRequestSchema.parse({})).toEqual({});
    expect(EmptyRequestSchema.safeParse({ channel: 'shell.execute' }).success).toBe(false);
    expect(EmptyRequestSchema.safeParse(null).success).toBe(false);
  });

  it('validates shell metadata and rejects secret-bearing fields', () => {
    const info = {
      name: 'Rovdo',
      version: '0.1.0',
      milestone: 'career-jobs',
      networkEnabled: false,
    };
    expect(AppInfoSchema.parse(info)).toEqual(info);
    expect(AppInfoSchema.safeParse({ ...info, apiKey: 'secret-canary' }).success).toBe(false);
    expect(AppInfoSchema.safeParse({ ...info, networkEnabled: true }).success).toBe(false);
  });
});
