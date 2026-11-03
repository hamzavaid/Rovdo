/** Supported keyless sources only; archive hits are leads, never proof of an active posting. */
import boards from './boards.json' with { type: 'json' };
import { RegistryEntrySchema } from '@rovdo/shared';
const adapters: Record<string, string> = {
  Remotive: 'remotive',
  Himalayas: 'himalayas',
  'We Work Remotely': 'wwr',
};
export const BOARD_REGISTRY = boards.map((board) =>
  RegistryEntrySchema.parse({
    ...board,
    id: board.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-$/, ''),
    mode: board.url.startsWith('https://github.com/')
      ? 'repository'
      : adapters[board.name] === 'wwr'
        ? 'feed'
        : 'native-api',
    adapter:
      adapters[board.name] ?? (board.url.startsWith('https://github.com/') ? 'github-list' : 'ats'),
    status: 'ready',
    policyUrl: board.url,
    limitation:
      'Public source. Source policies, availability, TTLs and collection health apply; employer postings are verified separately.',
  }),
);
export const DISCOVERY_SOURCES = [
  ...BOARD_REGISTRY,
  ...[
    {
      id: 'wayback',
      name: 'Wayback company discovery',
      url: 'https://web.archive.org/cdx/search/cdx',
      adapter: 'wayback',
    },
    {
      id: 'common-crawl',
      name: 'Common Crawl company discovery',
      url: 'https://index.commoncrawl.org/collinfo.json',
      adapter: 'common-crawl',
    },
  ].map((s) =>
    RegistryEntrySchema.parse({
      ...s,
      mode: 'indexed',
      status: 'ready',
      policyUrl: s.url,
      limitation:
        'Historical public URL index. Discovers board identities only; live ATS validation is required. No archived job content is treated as current.',
    }),
  ),
];
export const GLOBAL_DEFAULT_SOURCES = DISCOVERY_SOURCES.map((s) => s.id);
