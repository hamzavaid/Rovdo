import { expect, it } from 'vitest';
import { CareerStore } from './career';
import { sampleJob } from '../../../tests/fixtures/ranking-v2';
import { JobSchema } from '@rovdo/shared';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtsAdapter } from '@rovdo/job-sources';
import { rankWithProfile, BUILTIN_RANKINGS } from '@rovdo/career';
import { sampleCandidate, AS_OF } from '../../../tests/fixtures/ranking-v2';
it('transactionally converges canonical identities and preserves source, saved and applied state idempotently', () => {
  const store = new CareerStore(':memory:');
  try {
    const a = store.globalSource('a', 'Fixture', 'https://jobs.example.com/a'),
      b = store.globalSource('b', 'Fixture', 'https://jobs.example.com/b');
    const jobs = [
      { ...sampleJob(), id: 'a', canonicalUrl: 'https://jobs.example.com/a' },
      { ...sampleJob(), id: 'b', canonicalUrl: 'https://jobs.example.com/b' },
    ];
    for (const [i, s] of [a, b].entries()) {
      const j = jobs[i]!;
      j.provenance = [
        {
          sourceId: s.id,
          sourceKey: j.id,
          url: j.canonicalUrl,
          collectedAt: 1,
          rawSha256: j.rawSha256,
          fields: {},
        },
      ];
      store.batch(
        s,
        [j],
        store.sources().find((v) => v.config.id === s.id)!.state,
        'first',
        false,
        1,
      );
    }
    store.saveJob('a', true);
    store.saveJob('b', true);
    store.markJob('a', { feedback: 'relevant' });
    store.markJob('b', { feedback: 'irrelevant', applied: true });
    for (let i = 0; i < 2; i++)
      store.batch(
        a,
        [{ ...jobs[0]!, canonicalUrl: jobs[1]!.canonicalUrl }],
        store.sources().find((v) => v.config.id === a.id)!.state,
        'next',
        false,
        2,
      );
    expect(store.jobCount()).toBe(1);
    expect(store.savedIds()).toEqual(['a']);
    expect(store.job('b').id).toBe('a');
    expect(store.sourceRecords('a')).toHaveLength(2);
    expect(store.markers()[0]).toMatchObject({
      applied: true,
      feedback: 'none',
      feedbackConflicts: ['irrelevant', 'relevant'],
    });
    expect(store.job('a').provenance).toHaveLength(2);
  } finally {
    store.close();
  }
});
it('indexes mandatory graduation windows rather than an earlier preference', () => {
  const store = new CareerStore(':memory:');
  try {
    const s = store.globalSource('grad', 'Fixture', 'https://jobs.example.com');
    const j = sampleJob(
      'Preferred qualifications: graduation year 2026\nRequired qualifications: graduation year 2027',
    );
    j.provenance = [
      {
        sourceId: s.id,
        sourceKey: j.id,
        url: j.canonicalUrl,
        collectedAt: 1,
        rawSha256: j.rawSha256,
        fields: {},
      },
    ];
    store.batch(s, [j], store.sources()[0]!.state, 'one', false, 1);
    expect(
      store.searchFiltered({
        query: '',
        company: '',
        workMode: 'all',
        savedOnly: false,
        includeExcluded: false,
        graduationYear: 2027,
      }),
    ).toHaveLength(1);
  } finally {
    store.close();
  }
});
it('rejects invalid compensation, dates and non-hex digests at normalized ingress', () => {
  for (const salary of [
    { min: 2, max: 1, currency: 'USD', interval: 'annual', source: 'explicit' },
    { min: -1, max: 2, currency: 'USD', interval: 'annual', source: 'explicit' },
    { min: 1, max: 2, currency: 'money', interval: 'banana', source: 'explicit' },
  ])
    expect(JobSchema.safeParse({ ...sampleJob(), salary }).success).toBe(false);
  expect(JobSchema.safeParse({ ...sampleJob(), postedAt: '2026-02-30' }).success).toBe(false);
  expect(JobSchema.safeParse({ ...sampleJob(), contentSha256: 'z'.repeat(64) }).success).toBe(
    false,
  );
});
it('quarantines malformed optional compensation without discarding valid postings', () => {
  const store = new CareerStore(':memory:');
  try {
    const s = {
      ...store.globalSource('pay', 'Fixture', 'https://jobs.example.com'),
      ats: 'lever' as const,
    };
    const adapter = new AtsAdapter(s);
    for (const salaryRange of [
      { min: 200000, max: 100000, currency: 'USD', interval: 'year' },
      { min: 'invalid', max: 100000, currency: 'USD', interval: 'year' },
    ]) {
      const result = adapter.normalizeDetailed([
        {
          id: '1',
          text: 'Engineer',
          hostedUrl: 'https://jobs.example.com/1',
          descriptionPlain: 'TypeScript',
          salaryRange,
        },
      ]);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]!.salary).toBe(null);
      expect(result.quarantine[0]!.code).toBe('INVALID_COMPENSATION');
    }
  } finally {
    store.close();
  }
});
it('keeps conflicting mandatory graduation windows retrievable and UNKNOWN in eligibility', () => {
  const j = sampleJob('Required qualifications\nGraduation year 2026\nGraduation year 2027');
  const m = rankWithProfile(
    [{ job: j, bm25Raw: 0 }],
    sampleCandidate(),
    BUILTIN_RANKINGS[1]!,
    AS_OF,
  )[0]!;
  expect(m.checks.filter((c) => c.rule === 'graduation').every((c) => c.result === 'UNKNOWN')).toBe(
    true,
  );
});
it('rolls back an interrupted merge, recovers after restart and projects legacy optional pay without rewriting history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovdo-identity-'));
  const path = join(root, 'career.sqlite');
  let store = new CareerStore(path);
  let db: DatabaseSync | undefined;
  try {
    const a = store.globalSource('a', 'Fixture', 'https://jobs.example.com/a'),
      b = store.globalSource('b', 'Fixture', 'https://jobs.example.com/b');
    const jobs = [a, b].map((s, i) => ({
      ...sampleJob(),
      id: i ? 'b' : 'a',
      canonicalUrl: 'https://jobs.example.com/' + (i ? 'b' : 'a'),
      provenance: [
        {
          sourceId: s.id,
          sourceKey: i ? 'b' : 'a',
          url: 'https://jobs.example.com/' + (i ? 'b' : 'a'),
          collectedAt: 1,
          rawSha256: 'a'.repeat(64),
          fields: {},
        },
      ],
    }));
    for (const [i, s] of [a, b].entries())
      store.batch(
        s,
        [jobs[i]!],
        store.sources().find((v) => v.config.id === s.id)!.state,
        'one',
        false,
        1,
      );
    store.saveJob('a', true);
    store.saveJob('b', true);
    db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER interrupt_merge BEFORE DELETE ON career_job WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'fixture interruption'); END;",
    );
    const update = { ...jobs[0]!, canonicalUrl: jobs[1]!.canonicalUrl };
    expect(() =>
      store.batch(
        a,
        [update],
        store.sources().find((v) => v.config.id === a.id)!.state,
        'two',
        false,
        2,
      ),
    ).toThrow('fixture interruption');
    expect(store.jobCount()).toBe(2);
    expect(store.savedIds()).toEqual(['a', 'b']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_identity_alias').get()!.n).toBe(0);
    db.exec('DROP TRIGGER interrupt_merge');
    store.close();
    store = new CareerStore(path);
    store.batch(
      a,
      [update],
      store.sources().find((v) => v.config.id === a.id)!.state,
      'two',
      false,
      2,
    );
    expect(store.job('b').id).toBe('a');
    db.prepare("UPDATE career_job SET json=json_set(json,'$.salary',json(?)) WHERE id='a'").run(
      JSON.stringify({
        min: 200000,
        max: 100000,
        currency: 'USD',
        interval: 'year',
        source: 'explicit',
      }),
    );
    store.close();
    store = new CareerStore(path);
    expect(store.job('a').salary).toBe(null);
    expect(
      JSON.parse(String(db.prepare("SELECT json FROM career_job WHERE id='a'").get()!.json)).salary
        .min,
    ).toBe(200000);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
