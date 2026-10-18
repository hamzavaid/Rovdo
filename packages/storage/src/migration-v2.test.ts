import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { rankJobs } from '@rovdo/career';
import { sampleCandidate, sampleJob } from '../../../tests/fixtures/ranking-v2';

it('migrates a real v1 schema without rewriting profiles, jobs, rankings or saved opportunities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rovdo-v2-')); const path = join(dir, 'career.sqlite');
  const target = resolve(dir); if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('rovdo-v2-')) throw new Error('Unsafe cleanup');
  const profile = sampleCandidate(); delete profile.intelligence;
  const job = sampleJob(); const match = rankJobs([{ job, bm25Raw: 0 }], profile)[0]!;
  const db = new DatabaseSync(path); db.exec(readFileSync('tests/fixtures/career-schema-v1.sql', 'utf8'));
  db.prepare('INSERT INTO candidate_profile VALUES(?,?)').run(1, JSON.stringify(profile));
  db.prepare('INSERT INTO career_job VALUES(?,?,?,?,?,?)').run(job.id, job.canonicalUrl, job.company, null, 'signature', JSON.stringify(job));
  db.prepare('INSERT INTO job_match VALUES(?,?,?,?)').run(job.id, 1, 'deterministic-v1', JSON.stringify(match));
  db.prepare('INSERT INTO saved_opportunity VALUES(?,?)').run(job.id, 1); db.close();
  try {
    let store = new CareerStore(path); expect(store.profile()).toEqual(profile); expect(store.jobs()).toEqual([job]); expect(store.savedIds()).toEqual([job.id]);
    const custom = store.cloneRanking('builtin:technical-balanced', 'Persisted'); store.setDefaultRanking(custom.id); store.close();
    store = new CareerStore(path); expect(store.defaultRanking()).toBe(custom.id); expect(store.rankings().some((r) => r.id === custom.id)).toBe(true); store.close();
    const check = new DatabaseSync(path);
    try { expect(check.prepare('SELECT json FROM job_match').get()!.json).toBe(JSON.stringify(match)); expect(check.prepare('SELECT json FROM candidate_profile').get()!.json).toBe(JSON.stringify(profile)); expect(check.prepare('SELECT MAX(version) AS v FROM career_schema').get()!.v).toBe(5); } finally { check.close(); }
  } finally { rmSync(target, { recursive: true, force: true }); }
});

