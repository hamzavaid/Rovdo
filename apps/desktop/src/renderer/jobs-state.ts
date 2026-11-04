/** Renderer-only display/criteria helpers. Collection settings never become cached-result filters. */
import type { JobSearch } from '@rovdo/shared';
import { stable } from '@rovdo/career';
import { defaultDiscovery } from './GlobalDiscovery';
export const initialJobSearch: JobSearch = {
  scope: 'global',
  discovery: defaultDiscovery,
  query: '',
  company: '',
  workMode: 'all',
  savedOnly: false,
  includeExcluded: false,
  offset: 0,
  pageSize: 10,
};
export const presetKey = (search: JobSearch) => stable({ ...search, offset: 0, savedOnly: false });
const names: Record<string, string> = {
  'builtin:legacy-v1': 'Classic',
  'builtin:technical-balanced': 'Balanced Match',
  'builtin:technical-conservative': 'Strict Match',
  'builtin:technical-lenient': 'Flexible Match',
  'builtin:opportunity-hybrid': 'Career Fit',
};
export const rankingLabel = (ranking: { id: string; name: string }) =>
  names[ranking.id] ?? ranking.name;
export const dateLabel = (at: number | null | undefined) =>
  at ? new Date(at).toLocaleString() : 'Not yet';
