/** Offline release metadata and resumable, bounded installation. No membership lists are fetched on startup. */
import { createHash } from 'node:crypto';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { EMPLOYERS, feedFromUrl } from './directory';
import { StarterDirectoryManifestSchema } from '@rovdo/shared';
import type { StarterDirectoryManifest, StarterEmployer } from '@rovdo/shared';
export interface StarterDirectorySink {
  starterDirectoryState(release: string, hash: string): { after: string; complete: boolean };
  installStarterDirectoryBatch(
    release: string,
    hash: string,
    rows: StarterEmployer[],
    complete: boolean,
    boards: { employerId: string; ats: string; tenant: string; region: string; pageUrl: string }[],
  ): void;
}
export async function installStarterDirectory(
  input: unknown,
  sink: StarterDirectorySink,
  options: {
    batchSize?: number;
    yieldTurn?: () => Promise<void>;
    signal?: AbortSignal;
  } = {},
) {
  const yieldTurn =
    options.yieldTurn ??
    (async () => {
      await yieldImmediate();
    });
  await yieldTurn();
  const manifest = StarterDirectoryManifestSchema.parse(input);
  const rows = [...manifest.employers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  // Normalize precision before comparing release identities chronologically in SQLite.
  const release = `${manifest.version}:${new Date(manifest.releasedAt).toISOString()}`;
  const state = sink.starterDirectoryState(release, hash);
  if (state.complete) return;
  const batchSize = Math.max(1, Math.min(50, Math.floor(options.batchSize ?? 50)));
  if (!Number.isFinite(batchSize)) throw new Error('INVALID_DIRECTORY_BATCH_SIZE');
  let offset = rows.findIndex((e) => e.id > state.after);
  if (offset < 0) offset = rows.length;
  do {
    options.signal?.throwIfAborted();
    const batch = rows.slice(offset, offset + batchSize);
    offset += batch.length;
    const boards = batch.flatMap((employer) =>
      employer.boards.flatMap((board) => {
        const feed = feedFromUrl(board.url);
        return feed && feed.ats === board.adapter
          ? [{ employerId: employer.id, ...feed, pageUrl: board.url }]
          : [];
      }),
    );
    sink.installStarterDirectoryBatch(release, hash, batch, offset >= rows.length, boards);
    await yieldTurn();
  } while (offset < rows.length);
}
const releasedAt = '2026-11-11T00:00:00Z';
function employer(
  id: string,
  name: string,
  categories: string[],
  url: string,
  adapter: StarterEmployer['boards'][number]['adapter'],
  checkedAt = releasedAt,
): StarterEmployer {
  return {
    id,
    name,
    aliases: [],
    categories,
    referenceSets: [{ id: 'broader', edition: '2026-11' }],
    boards: [{ url, adapter }],
    provenance: [{ url, checkedAt }],
  };
}
/** Reviewed factual starter subset. This release does not claim the three reference sets are complete. */
export const STARTER_DIRECTORY: StarterDirectoryManifest = {
  version: 1,
  releasedAt,
  employers: [
    employer(
      'astranis',
      'Astranis',
      ['aerospace', 'manufacturing'],
      'https://job-boards.greenhouse.io/astranis',
      'greenhouse',
    ),
    employer(
      'bosch',
      'Bosch',
      ['manufacturing', 'automotive'],
      'https://careers.smartrecruiters.com/BoschGroup',
      'smartrecruiters',
    ),
    employer(
      'eurofins',
      'Eurofins',
      ['laboratory', 'healthcare'],
      'https://careers.smartrecruiters.com/Eurofins',
      'smartrecruiters',
    ),
    employer(
      'figma',
      'Figma',
      ['design', 'software'],
      'https://job-boards.greenhouse.io/figma',
      'greenhouse',
    ),
    employer(
      'givewell',
      'GiveWell',
      ['nonprofit', 'research'],
      'https://job-boards.greenhouse.io/givewell',
      'greenhouse',
    ),
    employer('linear', 'Linear', ['software'], 'https://jobs.ashbyhq.com/linear', 'ashby'),
    employer(
      'mayo-clinic',
      'Mayo Clinic',
      ['healthcare', 'research'],
      'https://careers.mayoclinic.org/careers',
      'unsupported',
    ),
    employer(
      'palantir',
      'Palantir Technologies',
      ['software', 'analytics'],
      'https://jobs.lever.co/palantir',
      'lever',
      '2026-10-18T00:00:00Z',
    ),
    employer(
      'smartrecruiters',
      'SmartRecruiters',
      ['recruiting', 'software'],
      'https://careers.smartrecruiters.com/SmartRecruiters',
      'smartrecruiters',
      '2026-10-18T00:00:00Z',
    ),
    employer(
      'walmart',
      'Walmart',
      ['retail', 'logistics', 'healthcare'],
      'https://careers.walmart.com/us/en/home',
      'unsupported',
    ),
  ],
};

/** Prior release stays available; applying it cannot revoke identities from a newer release. */
export const PRIOR_STARTER_DIRECTORY: StarterDirectoryManifest = {
  version: 1,
  releasedAt: '2026-10-18T00:00:00Z',
  employers: EMPLOYERS.map((e) => ({
    id: e.id,
    name: e.company,
    aliases: [...e.aliases],
    categories: [],
    referenceSets: [{ id: 'broader', edition: '2026-10' }],
    boards: [{ url: e.reference, adapter: e.ats }],
    provenance: [{ url: e.reference, checkedAt: e.verifiedAt }],
  })),
};
