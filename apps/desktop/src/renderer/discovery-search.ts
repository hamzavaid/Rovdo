/** Carry the existing search form into collection; source selection never asks for duplicate criteria. */
import type { DiscoveryOptions, JobSearch } from '@rovdo/shared';
export function discoveryOptionsForSearch(
  search: JobSearch,
  fallback: DiscoveryOptions,
): DiscoveryOptions {
  return {
    ...(search.discovery ?? fallback),
    filters: {
      keywords: search.query.trim(),
      ...(search.location ? { location: search.location } : {}),
      workMode: search.workMode,
      ...(search.employmentType ? { employmentType: search.employmentType } : {}),
      ...(search.freshnessDays ? { freshnessDays: search.freshnessDays } : {}),
    },
  };
}
