/** Capability catalog, not a claim that every listed website has a working scraper. */
import boards from './boards.json';
import { RegistryEntrySchema } from '@rovdo/shared';
const ats = new Set(['Greenhouse', 'Lever', 'Ashby', 'SmartRecruiters']);
const scrapers = new Set([
  'LinkedIn Jobs',
  'Indeed',
  'Glassdoor',
  'ZipRecruiter',
  'Bayt',
  'Naukri',
  'Google for Jobs',
]);
const api = new Map([
  ['Remotive', 'remotive'],
  ['Himalayas', 'himalayas'],
]);
export const BOARD_REGISTRY = boards.map((board) => {
  const github = board.url.startsWith('https://github.com/');
  const direct = api.get(board.name);
  const mode = ats.has(board.name)
    ? 'native-api'
    : direct
      ? 'native-api'
      : github
        ? 'repository'
        : board.name === 'We Work Remotely'
          ? 'feed'
          : scrapers.has(board.name)
            ? 'scraper'
            : ['Adzuna', 'Jooble', 'USAJOBS'].includes(board.name)
              ? 'unsupported'
              : 'indexed';
  const adapter = ats.has(board.name)
    ? 'ats'
    : (direct ??
      (github
        ? 'github-list'
        : board.name === 'We Work Remotely'
          ? 'wwr'
          : scrapers.has(board.name)
            ? 'jobspy'
            : 'index'));
  return RegistryEntrySchema.parse({
    ...board,
    id: board.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-$/, ''),
    mode,
    adapter,
    status:
      mode === 'scraper'
        ? 'blocked'
        : mode === 'unsupported'
          ? 'unsupported'
          : mode === 'indexed'
            ? 'configuration'
            : 'ready',
    policyUrl: board.url,
    limitation:
      mode === 'scraper'
        ? 'Direct JobSpy network scraping is disabled: no approved policy/transport integration. Lawfully obtained rows may be imported.'
        : mode === 'indexed'
          ? 'Requires a permitted SearXNG JSON endpoint. Indexed hits are unverified, not direct scraper coverage.'
          : mode === 'unsupported'
            ? 'Credentialed/provider-specific API is not implemented.'
            : adapter === 'ats'
              ? 'Employer-scoped feed; discovered dynamically from public listing URLs, not a universal ATS search.'
              : adapter === 'himalayas'
                ? 'Daily cached data; required applicationLink/source credit retained; redistribution export disabled.'
                : adapter === 'remotive'
                  ? 'Delayed 24h; source credit/link retained; fetched at most every 6h; redistribution export disabled.'
                  : 'Public feed/repository; original postings require availability verification.',
  });
});
export const GLOBAL_DEFAULT_SOURCES = BOARD_REGISTRY.filter((s) => s.status === 'ready').map(
  (s) => s.id,
);

/** An unrestricted, user-configured index is separate from the 126-board capability catalog. */
export const DISCOVERY_SOURCES = [
  ...BOARD_REGISTRY,
  RegistryEntrySchema.parse({
    id: 'web-index',
    name: 'Open web index',
    url: 'https://docs.searxng.org/dev/search_api.html',
    mode: 'indexed',
    status: 'configuration',
    adapter: 'index',
    policyUrl: 'https://docs.searxng.org/dev/search_api.html',
    limitation:
      'Requires a permitted SearXNG JSON endpoint. Broad qualification queries have no site restriction; results remain unverified until resolved.',
  }),
];
