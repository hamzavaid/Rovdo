import { expect, it } from 'vitest';
import supplied from '../../job-sources/data/Rovdo_Starter_Directory.json' with { type: 'json' };
import {
  STARTER_DIRECTORY,
  REVIEWED_STARTER_DIRECTORY,
  installStarterDirectory,
} from '@rovdo/job-sources';
import { canonicalBoardUrl, StarterDirectoryManifestSchema } from '@rovdo/shared';
import { CareerStore } from './career';

it('ships every supplied board while retaining reviewed legacy employer identities', () => {
  const release = StarterDirectoryManifestSchema.parse(STARTER_DIRECTORY);
  const boards = new Set(
    release.employers.flatMap((e) => e.boards.map((b) => canonicalBoardUrl(b.url))),
  );
  expect(supplied.employers).toHaveLength(9935);
  for (const entry of supplied.employers)
    for (const board of entry.boards) expect(boards.has(canonicalBoardUrl(board.url))).toBe(true);
  expect(release.releasedAt).toBe(supplied.releasedAt);
  expect(release.employers.find((e) => e.id === 'figma')?.categories).toContain('design');
  expect(
    release.employers.filter((e) => e.boards.some((b) => b.adapter === 'unsupported')),
  ).toHaveLength(33);
});

it('installs the full supplied release cooperatively without resetting an existing opt-out', async () => {
  const store = new CareerStore(':memory:');
  const feed = { ats: 'ashby', tenant: '0g', region: 'global' };
  store.global.rememberCompany(feed, 'User edited name', 'https://jobs.ashbyhq.com/0g', 1);
  store.global.setBoardEnabled('ashby:0g:global', false);
  let batches = 0;
  try {
    await installStarterDirectory(REVIEWED_STARTER_DIRECTORY, store);
    store.global.setBoardEnabled('greenhouse:figma:global', false);
    await installStarterDirectory(STARTER_DIRECTORY, store, {
      yieldTurn: async () => {
        batches++;
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    });
    expect(batches).toBeGreaterThanOrEqual(200);
    expect(store.starterDirectoryPage({}).total).toBe(9940);
    expect(store.global.companyPage({}).total).toBe(9907);
    expect(store.global.board('greenhouse:figma:global')?.enabled).toBe(false);
    expect(store.companyIdentity('Figma')).toBe('figma');
    expect(store.global.board('ashby:0g:global')).toMatchObject({
      company: 'User edited name',
      enabled: false,
      lastSuccess: null,
    });
    await installStarterDirectory(STARTER_DIRECTORY, store);
    await installStarterDirectory(REVIEWED_STARTER_DIRECTORY, store);
    expect(store.starterDirectoryPage({}).total).toBe(9940);
  } finally {
    store.close();
  }
}, 30000);
