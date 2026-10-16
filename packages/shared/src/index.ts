import { z } from 'zod';
import type { ByokApi } from './byok';
import type { BrowserApi } from './browser';
export * from './byok';
export * from './browser';

export const ErrorCodeSchema = z.enum(['VALIDATION_ERROR', 'IPC_FORBIDDEN', 'INTERNAL_ERROR']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const RunStateSchema = z.enum([
  'CREATED', 'QUEUED', 'PREFLIGHT', 'PLANNING', 'EXECUTING', 'VERIFYING',
  'AWAITING_APPROVAL', 'PAUSED', 'RETRYING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELED',
]);
export type RunState = z.infer<typeof RunStateSchema>;

// Syntax validation only. Execution must also resolve destinations and check
// IPs, redirects and per-run authorization at the action broker boundary.
const ExternalOriginSchema = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    const labels = url.hostname.split('.');
    return url.protocol === 'https:' && url.origin === value &&
      !url.username && !url.password && labels.length > 1 &&
      labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) &&
      /^[a-z]{2,}$/i.test(labels.at(-1)!) &&
      !/\.(local|localhost|internal|lan|home)$/i.test(url.hostname);
  } catch {
    return false;
  }
}, 'Expected an explicit external HTTPS origin without credentials, path or query');

export const StartRunSchema = z.strictObject({
  task: z.string().trim().min(1).max(10_000),
  workflow: z.enum(['career', 'browser']),
  modelProfileId: z.string().trim().min(1).max(200),
  maxSteps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxUsd: z.number().finite().nonnegative(),
  allowedOrigins: z.array(ExternalOriginSchema).min(1),
  applicationLimit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  submitMode: z.enum(['review-only', 'approve-each']),
});
export type StartRun = z.infer<typeof StartRunSchema>;

export const EmptyRequestSchema = z.strictObject({});
export const AppInfoSchema = z.strictObject({
  name: z.literal('Rovdo'),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  milestone: z.literal('desktop-byok'),
  networkEnabled: z.literal(false),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const APP_INFO_CHANNEL = 'app:get-info';
export interface DesktopApi extends ByokApi, BrowserApi {
  getAppInfo(): Promise<AppInfo>;
}

// No arbitrary messages, Error values, URLs or nested payloads are loggable.
export const DiagnosticEventSchema = z.strictObject({
  level: z.enum(['info', 'warn', 'error']),
  event: z.enum(['app.started', 'app.stopped', 'ipc.rejected', 'diagnostics.rejected']),
  component: z.enum(['main', 'agent-core']),
  errorCode: ErrorCodeSchema.optional(),
  runId: z.uuid().optional(),
});
