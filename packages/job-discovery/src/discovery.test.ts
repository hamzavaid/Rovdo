import { describe, expect, it, vi } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { AtsAdapter } from '@rovdo/job-sources';
import { evaluateEligibility, rankJobs } from '@rovdo/career';
import { CandidateProfileSchema } from '@rovdo/shared';
import type { CandidateProfile, ProfileFact, SourceConfig } from '@rovdo/shared';
import { DiscoveryEngine } from './index';

// Discovery must not import or invoke the provider gateway.
vi.mock('@rovdo/providers', () => {
  throw new Error('AI is forbidden in deterministic discovery');
});
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const fact = (field: ProfileFact['field'], value: string): ProfileFact => ({
  id: `${field}-${value}`,
  field,
  value,
  verified: true,
  source: {
    kind: 'user' as const,
    reference: 'Explicit fixture assertion',
    capturedAt: '2026-10-16T00:00:00.000Z',
  },
});
const profile: CandidateProfile = {
  version: 1,
  facts: [
    fact('skill', 'TypeScript'),
    fact('workAuthorization', 'US'),
    fact('degree', 'Bachelor'),
    fact('graduationYear', '2027'),
    fact('returnToSchool', 'yes'),
  ],
  preferences: {
    roles: ['Engineer'],
    excludedRoles: [],
    locations: ['Remote'],
    workModes: ['remote'],
    levels: [],
    minimumSalary: null,
    currency: 'USD',
    weights: { skills: 0.35, role: 0.2, location: 0.15, eligibility: 0.2, preferences: 0.1 },
  },
};
const source = (ats: SourceConfig['ats'], n: number): SourceConfig => ({
  id: ids[n]!,
  ats,
  tenant: `fixture${n}`,
  company: `Fixture ${n}`,
  enabled: true,
  region: 'global',
  intervalMs: 86400000,
  termsReviewedAt: '2026-10-16T00:00:00.000Z',
  timezone: 'America/Los_Angeles',
  priority: n,
  missingGracePolls: 3,
});
function raw(ats: SourceConfig['ats'], index: number) {
  const description =
    index % 5
      ? 'TypeScript Engineer. Work authorization: US required. Degree: Bachelor required.'
      : 'Unrelated sales opportunity. Active clearance required.';
  const common = { title: index % 5 ? `Engineer ${index}` : `Sales ${index}`, location: 'Remote' };
  if (ats === 'greenhouse')
    return {
      id: index,
      title: common.title,
      location: { name: 'Remote' },
      content: `<p>${description}</p>`,
      absolute_url: `https://boards.greenhouse.io/fixture/jobs/${index}`,
    };
  if (ats === 'lever')
    return {
      id: String(index),
      text: common.title,
      categories: { location: 'Remote', commitment: 'Full-time' },
      descriptionPlain: description,
      hostedUrl: `https://jobs.lever.co/fixture/${index}`,
      workplaceType: 'remote',
    };
  return {
    id: String(index),
    ...common,
    descriptionPlain: description,
    jobUrl: `https://jobs.ashbyhq.com/fixture/${index}`,
    isListed: true,
    isRemote: true,
    employmentType: 'FullTime',
  };
}

describe('zero-AI 1,000-job corpus v1', () => {
  it('ingests three ATS formats, ranks stably, retains evidence and polls idempotently without a model', async () => {
    const store = new CareerStore(':memory:');
    let time = Date.parse('2026-10-16T00:00:00Z');
    let calls = 0;
    const transport = async (url: string) => {
      calls++;
      const ats = url.includes('greenhouse')
        ? 'greenhouse'
        : url.includes('lever')
          ? 'lever'
          : 'ashby';
      const start = ats === 'greenhouse' ? 0 : ats === 'lever' ? 334 : 667;
      const length = ats === 'greenhouse' ? 334 : 333;
      const all = Array.from({ length }, (_, i) => raw(ats, start + i));
      const skip = Number(new URL(url).searchParams.get('skip') ?? 0);
      const body = ats === 'lever' ? all.slice(skip, skip + 100) : { jobs: all };
      return {
        status: 200,
        headers: { etag: 'fixture-v1' },
        body: Buffer.from(JSON.stringify(body)),
      };
    };
    const engine = new DiscoveryEngine(store, (s) => new AtsAdapter(s, transport), {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      random: () => 0,
    });
    try {
      store.saveProfile(profile);
      for (const [i, ats] of (['greenhouse', 'lever', 'ashby'] as const).entries())
        store.saveSource(source(ats, i));
      await engine.pollAll();
      expect(store.jobs()).toHaveLength(1000);
      expect(calls).toBe(6);
      const scored = rankJobs(store.search('TypeScript Engineer'), store.profile()!);
      expect(scored.length).toBe(800);
      expect(scored.every((r) => !r.excluded)).toBe(true);
      expect(scored.slice(0, 10).every((r) => r.job.title.startsWith('Engineer'))).toBe(true);
      const stable = scored.map((r) => [r.job.id, r.score]);
      const firstSeen = store.jobs()[0]!.firstSeenAt;
      time += 86400001;
      await engine.pollAll();
      expect(store.jobs()).toHaveLength(1000);
      expect(store.jobs()[0]!.firstSeenAt).toBe(firstSeen);
      expect(
        rankJobs(store.search('TypeScript Engineer'), store.profile()!).map((r) => [
          r.job.id,
          r.score,
        ]),
      ).toEqual(stable);
      expect(
        store.sources().every((s) => s.state.status === 'OK' && s.state.lastSuccessAt !== null),
      ).toBe(true);
      expect(store.jobs().every((j) => j.provenance.length && j.contentSha256.length === 64)).toBe(
        true,
      );
      // Labeled gold set: 800 relevant engineer postings, 200 unrelated sales.
      expect(scored.length / 800).toBe(1); // recall on corpus-v1
    } finally {
      store.close();
    }
  });
});

describe('polling resilience', () => {
  it('preserves accepted jobs on 429/5xx/schema drift and distinguishes empty feeds', async () => {
    const store = new CareerStore(':memory:');
    const config = source('greenhouse', 0);
    let time = 1000000000000;
    let status = 200;
    let payload: unknown = { jobs: [raw('greenhouse', 1)] };
    const engine = new DiscoveryEngine(
      store,
      (s) =>
        new AtsAdapter(s, async () => ({
          status,
          headers: { 'retry-after': '120' },
          body: Buffer.from(JSON.stringify(payload)),
        })),
      {
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        random: () => 0,
      },
    );
    try {
      store.saveSource(config);
      await engine.poll(config.id);
      expect(store.jobs()).toHaveLength(1);
      for (const error of [429, 503]) {
        status = error;
        time += 86400001;
        await engine.poll(config.id);
        expect(store.jobs()).toHaveLength(1);
        expect(store.sources()[0]!.state.status).toBe('FAILED_SOURCE');
      }
      status = 200;
      payload = { jobs: [{ changed: true }] };
      time += 86400001;
      await engine.poll(config.id);
      expect(store.sources()[0]!.state.status).toBe('FAILED_SOURCE');
      expect(store.jobs()[0]!.activeStatus).toBe('open');
      payload = { jobs: [] };
      time += 86400001;
      await engine.poll(config.id);
      expect(store.sources()[0]!.state.status).toBe('EMPTY_SOURCE');
      expect(store.jobs()[0]!.activeStatus).toBe('open');
    } finally {
      store.close();
    }
  });
  it('handles conditional 304 and rejects off-source pagination', async () => {
    const store = new CareerStore(':memory:');
    const config = source('greenhouse', 0);
    let time = 1000000000000;
    let second = false;
    const engine = new DiscoveryEngine(
      store,
      (s) =>
        new AtsAdapter(s, async (_url, options) => {
          if (second) expect(options?.headers?.['if-none-match']).toBe('"v1"');
          return {
            status: second ? 304 : 200,
            headers: { etag: '"v1"' },
            body: Buffer.from(JSON.stringify({ jobs: [raw('greenhouse', 1)] })),
          };
        }),
      {
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        random: () => 0,
      },
    );
    try {
      store.saveSource(config);
      await engine.poll(config.id);
      second = true;
      time += 86400001;
      await engine.poll(config.id);
      expect(store.jobs()).toHaveLength(1);
      expect(store.sources()[0]!.state.failures).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe('verified profile and eligibility', () => {
  it('preserves verified facts when importing proposals and rejects stale profile edits', () => {
    const store = new CareerStore(':memory:');
    try {
      store.saveProfile(profile);
      store.proposeFacts([
        { ...fact('skill', 'Rust'), verified: true },
        { ...profile.facts[0]!, value: 'invented' },
      ]);
      expect(store.profile()!.facts[0]!.value).toBe('TypeScript');
      expect(store.profile()!.facts.at(-1)!.verified).toBe(false);
      expect(() => store.saveProfile(profile)).toThrow();
    } finally {
      store.close();
    }
  });
  it('deduplicates canonical targets across sources without losing provenance or saved state', async () => {
    const store = new CareerStore(':memory:');
    const a = source('greenhouse', 0);
    const b = { ...source('lever', 1), company: a.company };
    const fixture = raw('greenhouse', 1) as { absolute_url: string };
    const mirror = {
      ...raw('lever', 99),
      hostedUrl: `${fixture.absolute_url}?utm_campaign=mirror`,
    };
    const engine = new DiscoveryEngine(
      store,
      (s) =>
        new AtsAdapter(s, async () => ({
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify(s.ats === 'lever' ? [mirror] : { jobs: [fixture] })),
        })),
      { random: () => 0 },
    );
    try {
      store.saveSource(a);
      store.saveSource(b);
      await engine.pollAll();
      expect(store.jobs()).toHaveLength(1);
      expect(store.jobs()[0]!.provenance).toHaveLength(2);
      store.saveJob(store.jobs()[0]!.id, true);
      expect(store.savedIds()).toHaveLength(1);
    } finally {
      store.close();
    }
  });
  it('requires provenance, user-only legal assertions and normalized weight sums', () => {
    expect(
      CandidateProfileSchema.safeParse({
        ...profile,
        facts: [{ field: 'skill', value: 'Rust', verified: true }],
      }).success,
    ).toBe(false);
    expect(
      CandidateProfileSchema.safeParse({
        ...profile,
        facts: [
          {
            ...fact('citizenship', 'US'),
            source: { kind: 'document', reference: 'resume', capturedAt: new Date().toISOString() },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CandidateProfileSchema.safeParse({
        ...profile,
        preferences: {
          ...profile.preferences,
          weights: { skills: 1, role: 1, location: 1, eligibility: 1, preferences: 1 },
        },
      }).success,
    ).toBe(false);
  });
  it('returns UNKNOWN for absent/unverified legal facts and FAIL only on an explicit conflict', () => {
    const job = new AtsAdapter(source('greenhouse', 0), async () => {
      throw new Error('no network');
    }).normalize({ jobs: [raw('greenhouse', 1)] })[0]!;
    expect(evaluateEligibility(job, profile).some((r) => r.result === 'FAIL')).toBe(false);
    expect(
      evaluateEligibility(job, { ...profile, facts: [] }).some((r) => r.result === 'UNKNOWN'),
    ).toBe(true);
    expect(
      evaluateEligibility(job, { ...profile, facts: [fact('workAuthorization', 'no')] }).some(
        (r) => r.result === 'FAIL',
      ),
    ).toBe(true);
    expect(
      evaluateEligibility(job, {
        ...profile,
        facts: profile.facts.map((f) => ({ ...f, verified: false })),
      }).some((r) => r.result === 'UNKNOWN'),
    ).toBe(true);
  });
});
