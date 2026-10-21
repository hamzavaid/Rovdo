/** Durable, provider-independent global discovery contracts. No AI or candidate contacts cross this API. */
import { z } from 'zod';
export const DiscoveryFiltersSchema = z.strictObject({
  keywords: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  workMode: z.enum(['all', 'remote', 'hybrid', 'onsite']).optional(),
  employmentType: z.string().max(40).optional(),
});
export const DiscoveryOptionsSchema = z.strictObject({
  sourceIds: z.array(z.string().max(200)).max(1000),
  overrides: z.record(z.string().max(200), DiscoveryFiltersSchema).default({}),
  indexUrl: z.string().url().max(2048).optional(),
});
export type DiscoveryOptions = z.infer<typeof DiscoveryOptionsSchema>;
export const RegistryEntrySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  mode: z.enum(['native-api', 'feed', 'repository', 'indexed', 'scraper', 'unsupported']),
  status: z.enum(['ready', 'configuration', 'blocked', 'unsupported']),
  adapter: z.string(),
  limitation: z.string(),
  policyUrl: z.string().url(),
});
export const DiscoveryRunSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['running', 'paused', 'completed', 'canceled']),
  createdAt: z.number(),
  updatedAt: z.number(),
  profileVersion: z.number().nullable(),
  queries: z.array(z.string().max(500)),
  options: DiscoveryOptionsSchema,
  reason: z.string().max(200).nullable(),
});
export type DiscoveryRun = z.infer<typeof DiscoveryRunSchema>;
export const DiscoveryTaskSchema = z.strictObject({
  id: z.string(),
  runId: z.uuid(),
  sourceId: z.string(),
  kind: z.enum(['provider', 'resolve', 'ats']),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'running', 'done', 'blocked']),
  nextAt: z.number(),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  priority: z.number(),
});
export type DiscoveryTask = z.infer<typeof DiscoveryTaskSchema>;
export const DiscoveryListingSchema = z.strictObject({
  id: z.string(),
  runId: z.uuid(),
  sourceId: z.string(),
  url: z.string().url().max(2048),
  title: z.string().max(500),
  company: z.string().max(200).nullable(),
  location: z.string().max(500),
  description: z.string().max(100000),
  status: z.enum(['pending', 'resolved', 'blocked', 'incomplete']),
  reason: z.string().nullable(),
});
export type DiscoveryListing = z.infer<typeof DiscoveryListingSchema>;
export const DiscoveryCoverageSchema = z.strictObject({
  sourceId: z.string(),
  status: z.string(),
  requests: z.number(),
  records: z.number(),
  rejected: z.number(),
  error: z.string().nullable(),
  updatedAt: z.number(),
});
export const DiscoveryViewSchema = z.strictObject({
  run: DiscoveryRunSchema.nullable(),
  runs: z.array(DiscoveryRunSchema),
  registry: z.array(RegistryEntrySchema),
  coverage: z.array(DiscoveryCoverageSchema),
  listings: z.array(DiscoveryListingSchema),
  listingCount: z.number(),
  companies: z.number(),
  jobs: z.number(),
  pending: z.number(),
  done: z.number(),
  filtered: z.number().default(0),
});
