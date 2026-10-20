/**
 * Validated browser requests, semantic actions, observations and durable run records.
 * Allow-listed commands constrain what can cross IPC; execution still requires runtime policy and approvals.
 */
import { z } from 'zod';
import { ProviderConfigSchema } from './byok';

export const BrowserOriginSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.origin === value &&
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !/^(localhost|\[|\d)/.test(u.hostname) &&
        u.hostname.includes('.') &&
        !/\.(local|internal|lan|home|localhost)$/.test(u.hostname)
      );
    } catch {
      return false;
    }
  });
const TargetSchema = z.strictObject({
  role: z.enum(['button', 'link', 'textbox', 'combobox', 'checkbox']),
  name: z.string().trim().min(1).max(200),
});
export const BrowserActionSchema = z.discriminatedUnion('tool', [
  z.strictObject({ tool: z.literal('navigate'), url: z.string().url().max(2048) }),
  z.strictObject({ tool: z.literal('snapshot') }),
  z.strictObject({ tool: z.literal('find'), target: TargetSchema }),
  z.strictObject({ tool: z.literal('click'), target: TargetSchema }),
  z.strictObject({ tool: z.literal('fill'), target: TargetSchema, value: z.string().max(2000) }),
  z.strictObject({ tool: z.literal('select'), target: TargetSchema, value: z.string().max(200) }),
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export const BrowserRequestSchema = z
  .strictObject({
    task: z.string().trim().min(1).max(4000),
    startUrl: z.string().url().max(2048),
    allowedOrigins: z.array(BrowserOriginSchema).min(1).max(10),
    expectedText: z.string().trim().min(1).max(200),
    modelProfileId: z.uuid(),
    maxSteps: z.number().int().min(1).max(100),
    maxUsd: z.number().finite().min(0).max(100),
    maxTokens: z.number().int().min(1).max(100000),
    maxDurationMs: z.number().int().min(1000).max(1800000),
    consent: z.literal(true),
  })
  .refine((v) => {
    try {
      const u = new URL(v.startUrl);
      return v.allowedOrigins.includes(u.origin) && !u.username && !u.password;
    } catch {
      return false;
    }
  });
export type BrowserRequest = z.infer<typeof BrowserRequestSchema>;
export const ObservationSchema = z.strictObject({
  url: z.string().max(2048),
  text: z.string().max(16000),
  challenge: z.boolean(),
});
export type Observation = z.infer<typeof ObservationSchema>;
export const BrowserRecordSchema = z.strictObject({
  id: z.uuid(),
  request: BrowserRequestSchema,
  providerSnapshot: ProviderConfigSchema.nullable(),
  state: z.enum([
    'CREATED',
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
  ]),
  createdAt: z.number(),
  deadline: z.number(),
  steps: z.number().int().nonnegative(),
  tokens: z.number().nonnegative(),
  spent: z.number().nonnegative(),
  lastUrl: z.string(),
  observation: ObservationSchema.nullable(),
  reason: z.string().max(80).nullable(),
  approval: z
    .strictObject({
      digest: z.string().length(64),
      summary: z.string().max(400),
      expiresAt: z.number(),
    })
    .nullable(),
});
export type BrowserRecord = z.infer<typeof BrowserRecordSchema>;
export const RunEventSchema = z.strictObject({
  seq: z.number().int(),
  kind: z.enum(['state', 'authorized', 'denied', 'verified', 'approval', 'recovered', 'usage']),
  at: z.number(),
  detail: z.string().max(500),
});
export type RunEvent = z.infer<typeof RunEventSchema>;
export const BrowserCommandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('list') }),
  z.strictObject({ op: z.literal('start'), request: BrowserRequestSchema }),
  z.strictObject({
    op: z.literal('control'),
    id: z.uuid(),
    action: z.enum(['pause', 'resume', 'cancel']),
  }),
  z.strictObject({
    op: z.literal('approve'),
    id: z.uuid(),
    digest: z.string().length(64),
    allow: z.boolean(),
  }),
]);
export type BrowserCommand = z.infer<typeof BrowserCommandSchema>;
export const BrowserResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    runs: z.array(BrowserRecordSchema),
    events: z.array(RunEventSchema),
    proposal: BrowserActionSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['VALIDATION_ERROR', 'IPC_FORBIDDEN', 'BROWSER_ERROR']),
  }),
]);
export const BROWSER_CHANNEL = 'browser:command';
export interface BrowserApi {
  browserCommand(command: BrowserCommand): Promise<z.infer<typeof BrowserResultSchema>>;
}
