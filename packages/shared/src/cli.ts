/** Narrow CLI preferences and public status. Executable paths/authentication material never cross IPC. */
import { z } from 'zod';
export const CliIdSchema = z.enum(['codex', 'claude', 'gemini', 'qwen', 'ollama']);
export type CliId = z.infer<typeof CliIdSchema>;
export const CliModelSchema = z
  .string()
  .trim()
  .max(150)
  .refine(
    (value) =>
      value === '' || (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value) && !value.includes('..')),
  );
export const CliPreferenceSchema = z.strictObject({
  id: CliIdSchema,
  model: CliModelSchema,
  timeoutMs: z.number().int().min(5000).max(300000),
});
export type CliPreference = z.infer<typeof CliPreferenceSchema>;
export const CliPermissionsSchema = z.strictObject({
  chat: z.boolean(),
  selectedFiles: z.boolean(),
});
export const CliAccessSchema = z.strictObject({
  id: CliIdSchema,
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  ...CliPermissionsSchema.shape,
});
export type CliAccess = z.infer<typeof CliAccessSchema>;
export const CliRefreshSchema = z.strictObject({ force: z.boolean().optional() });
export const CliTrustSchema = z.strictObject({
  ready: z.boolean().default(true),
  id: CliIdSchema,
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  testedAt: z.iso.datetime(),
  streaming: z.enum(['supported', 'unknown']),
  permissions: CliPermissionsSchema,
});
export const CliViewSchema = z.strictObject({
  id: CliIdSchema,
  profileId: z.uuid(),
  name: z.string().max(50),
  version: z.string().max(40).nullable(),
  status: z.enum([
    'not-installed',
    'installed',
    'authentication-required',
    'unsupported-version',
    'unsupported-mode',
    'connected',
    'unavailable',
  ]),
  model: CliModelSchema,
  models: z.array(CliModelSchema).max(500),
  timeoutMs: z.number().int(),
  streaming: z.enum(['supported', 'unknown']),
  text: z.enum(['supported', 'unknown']),
  revision: z.number().int().nonnegative(),
  conversationRevision: z.number().int().nonnegative().optional(),
  accessIdentity: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  authorization: CliPermissionsSchema.optional(),
});
export type CliView = z.infer<typeof CliViewSchema>;
export const CliTestSchema = z.strictObject({
  id: CliIdSchema,
  requestId: z.uuid(),
  consent: z.literal(true),
});
