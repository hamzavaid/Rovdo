import { describe, expect, it } from 'vitest';
import { AtsAdapter } from '@rovdo/job-sources';
import type { CandidateProfile, Job, SourceConfig } from '@rovdo/shared';
import { collectionDecision, inferCollectionScope } from './collection-scope';

function profile(locations: string[]): CandidateProfile {
  return {
    version: 1,
    facts: [],
    preferences: {
      roles: ['Software Engineer'],
      excludedRoles: ['Accountant'],
      locations,
      workModes: ['remote'],
      levels: ['internship'],
      minimumSalary: null,
      currency: 'USD',
      weights: { skills: 0.35, role: 0.2, location: 0.15, eligibility: 0.2, preferences: 0.1 },
    },
  };
}

function posting(location: string, title = 'Research Technician'): Job {
  const source: SourceConfig = {
    id: '00000000-0000-4000-8000-000000000001',
    ats: 'greenhouse',
    tenant: 'scope-fixture',
    company: 'Synthetic Retail Employer',
    enabled: true,
    region: 'global',
    intervalMs: 86400000,
    termsReviewedAt: '2026-11-11T00:00:00Z',
    timezone: 'UTC',
    priority: 0,
    missingGracePolls: 3,
  };
  const [job] = new AtsAdapter(source).normalize({
    jobs: [
      {
        id: 1,
        title,
        absolute_url: 'https://employer.example/jobs/1',
        location: { name: location },
        content: 'Full-time role. Prior industry experience required.',
      },
    ],
  });
  if (!job) throw new Error('Synthetic posting did not normalize');
  return job;
}

const usScope = { version: 1 as const, countries: ['US'], origin: 'profile' as const };

describe('collection country inference', () => {
  it('infers and deduplicates explicit profile countries', () => {
    expect(inferCollectionScope(profile(['United States', 'Canada', 'United States']))).toEqual({
      version: 1,
      countries: ['US', 'CA'],
      origin: 'profile',
    });
  });

  it('recognizes an unambiguous city and region without using device location', () => {
    expect(inferCollectionScope(profile(['Seattle, WA']))).toEqual(usScope);
  });

  it.each([null, profile([]), profile(['Remote']), profile(['Springfield'])])(
    'requires a country selection when profile location cannot establish a country: %j',
    (candidate) => {
      expect(inferCollectionScope(candidate)).toBeNull();
    },
  );

  it('does not infer collection geography from currency or qualification facts', () => {
    const candidate = profile([]);
    candidate.facts.push({
      id: 'authorization-us',
      field: 'workAuthorization',
      value: 'US',
      verified: true,
      source: { kind: 'user', reference: 'Synthetic fixture', capturedAt: '2026-11-11T00:00:00Z' },
    });
    expect(inferCollectionScope(candidate)).toBeNull();
  });
});

describe('broad geographic collection policy', () => {
  it.each(['Seattle, WA, United States', 'Remote - United States', 'Worldwide'])(
    'retains compatible posting: %s',
    (location) => {
      expect(collectionDecision(posting(location), usScope)).toEqual({
        include: true,
        reason: 'compatible',
      });
    },
  );

  it.each(['Berlin, Germany', 'Remote - Germany only'])(
    'excludes a clearly incompatible posting: %s',
    (location) => {
      expect(collectionDecision(posting(location), usScope)).toEqual({
        include: false,
        reason: 'incompatible',
      });
    },
  );

  it.each(['', 'Remote', 'Springfield'])(
    'retains uncertain geography and identifies uncertainty: %s',
    (location) => {
      expect(collectionDecision(posting(location), usScope)).toEqual({
        include: true,
        reason: 'unknown',
      });
    },
  );

  it('keeps a multilocation posting if any explicit location is in scope', () => {
    const job = posting('Berlin, Germany; Seattle, WA, United States');
    expect(collectionDecision(job, usScope)).toEqual({ include: true, reason: 'compatible' });
  });

  it('accepts any selected country rather than only the first country', () => {
    expect(
      collectionDecision(posting('Toronto, Canada'), {
        ...usScope,
        countries: ['US', 'CA'],
      }),
    ).toEqual({ include: true, reason: 'compatible' });
  });

  it('keeps niche and excluded role titles at employers outside the candidate role preferences', () => {
    const scope = inferCollectionScope(profile(['United States']));
    expect(scope).not.toBeNull();
    for (const title of [
      'Accountant',
      'Senior Hardware Reliability Specialist',
      'Research Technician',
    ]) {
      expect(collectionDecision(posting('United States', title), scope!)).toEqual({
        include: true,
        reason: 'compatible',
      });
    }
  });
});
