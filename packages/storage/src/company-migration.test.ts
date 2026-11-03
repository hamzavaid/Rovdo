import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { CareerStore } from './career';
import { sampleJob } from '../../../tests/fixtures/ranking-v2';
import { JobSearchSchema } from '@rovdo/shared';
it('migrates retired settings/searches while preserving jobs, application markers, opportunities and inventory across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rovdo-company-migration-'));
  const file = join(dir, 'career.sqlite');
  let store: CareerStore | undefined;
  let db: DatabaseSync | undefined;
  try {
    store = new CareerStore(file);
    const source = store.globalSource('fixture', 'Fixture', 'https://jobs.example.com/1');
    store.batch(
      source,
      [
        {
          ...sampleJob(),
          provenance: [
            {
              sourceId: source.id,
              sourceKey: '1',
              url: 'https://jobs.example.com/1',
              collectedAt: 100,
              rawSha256: 'b'.repeat(64),
              fields: {},
            },
          ],
        },
      ],
      store.sources()[0]!.state,
      'fixture',
      false,
      100,
    );
    store.saveJob('fixture:1', true);
    store.markJob('fixture:1', { applied: true });
    const saved = store.saveSearch(
      'Legacy broad search',
      JobSearchSchema.parse({
        query: 'Engineer',
        company: '',
        workMode: 'all',
        savedOnly: false,
        includeExcluded: true,
        scope: 'global',
      }),
    );
    store.global.rememberCompany(
      { ats: 'lever', tenant: 'example', region: 'eu' },
      'Example',
      'https://jobs.eu.lever.co/example',
      100,
    );
    store.global.validateCompany({ ats: 'lever', tenant: 'example', region: 'eu' }, 101);
    store.close();
    store = undefined;
    db = new DatabaseSync(file);
    const raw = JSON.parse(
      String(db.prepare('SELECT json FROM saved_search WHERE id=?').get(saved.id)!.json),
    );
    raw.search.discovery = {
      sourceIds: ['web-index', 'linkedin-jobs', 'lever'],
      overrides: {},
      indexUrl: 'https://retired.example/search',
    };
    db.prepare('UPDATE saved_search SET json=? WHERE id=?').run(JSON.stringify(raw), saved.id);
    db.prepare("DELETE FROM career_setting WHERE key='discovery-source-version'").run();
    db.prepare('INSERT INTO career_setting VALUES(?,?)').run(
      'jobspy-settings',
      JSON.stringify({ enabled: true }),
    );
    db.close();
    db = undefined;
    store = new CareerStore(file);
    expect(store.jobCount()).toBe(1);
    expect(store.savedIds()).toEqual(['fixture:1']);
    expect(store.markers()[0]!.applied).toBe(true);
    expect(store.savedSearches()[0]!.search.discovery!.sourceIds).toEqual([
      'lever',
      'wayback',
      'common-crawl',
    ]);
    expect(store.savedSearches()[0]!.search.discovery).not.toHaveProperty('indexUrl');
    expect(store.setting('jobspy-settings')).toBe(null);
    expect(store.global.companyBatch('', 10, true)[0]!.region).toBe('eu');
    store.close();
    store = undefined;
  } finally {
    store?.close();
    if (db?.isOpen) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
