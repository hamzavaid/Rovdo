/** Collection uses source selection only; saved view filters remain local. */
import type { DiscoveryOptions, JobSearch } from '@rovdo/shared';
export function discoveryOptionsForSearch(
  search: JobSearch,
  fallback: DiscoveryOptions,
): DiscoveryOptions {
  return { sourceIds: [...(search.discovery ?? fallback).sourceIds], overrides: {} };
}
