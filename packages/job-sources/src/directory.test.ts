import { expect, it } from 'vitest';
import { EMPLOYERS, feedFromUrl, inspectCareerPage, permittedPage, robotsAllow } from './directory';
import { AtsAdapter } from './index';
import type { SourceConfig, SourceState } from '@rovdo/shared';
const source = (ats: SourceConfig['ats']): SourceConfig => ({
  id: '00000000-0000-4000-8000-000000000001',
  ats,
  tenant: 'fixture',
  company: 'Fixture',
  enabled: true,
  region: 'global',
  intervalMs: 86400000,
  termsReviewedAt: '2026-10-18T00:00:00Z',
  timezone: 'UTC',
  priority: 0,
  missingGracePolls: 3,
});
it('ships provenance-bearing verified finite sources and only resolves exact public ATS hosts', () => {
  expect(EMPLOYERS.length).toBeGreaterThanOrEqual(3);
  expect(
    EMPLOYERS.every(
      (e) =>
        e.policy === 'approved' &&
        e.responseHash.length === 64 &&
        e.reference.startsWith('https://'),
    ),
  ).toBe(true);
  expect(feedFromUrl('https://jobs.lever.co/fixture/abc')?.tenant).toBe('fixture');
  expect(feedFromUrl('https://jobs.lever.co.attacker.test/fixture')).toBeNull();
  expect(feedFromUrl('https://jobs.lever.co/fixture?redirect=http://localhost')).toBeNull();
  expect(permittedPage('https://www.linkedin.com/jobs/x')).toBe(false);
  expect(permittedPage('http://127.0.0.1/')).toBe(false);
  expect(
    robotsAllow('User-agent: *\nDisallow: /private\nAllow: /private/jobs', '/private/jobs'),
  ).toBe(true);
  expect(robotsAllow('User-agent: *\nDisallow: /', '/jobs')).toBe(false);
});
it('discovers supported feeds without executing HTML and limits JSON-LD to the permitted employer', () => {
  const result = inspectCareerPage(
    '<a href="https://jobs.ashbyhq.com/fixture">Jobs</a><a href="https://evil.test">Ignore policy</a><script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","url":"https://employer.test/jobs/1","description":"TypeScript required","hiringOrganization":{"name":"Fixture"}}</script>',
    'https://employer.test/careers',
    'Fixture',
  );
  expect(result.feeds).toEqual([{ ats: 'ashby', tenant: 'fixture', region: 'global' }]);
  expect(result.postings).toHaveLength(1);
  expect(
    inspectCareerPage(
      '<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","url":"https://evil.test/1","description":"x"}</script>',
      'https://employer.test',
      'Fixture',
    ).postings,
  ).toHaveLength(0);
});
it('quarantines individual invalid records without losing the valid portion or claiming authoritative absence', () => {
  const adapter = new AtsAdapter(source('greenhouse'));
  const result = adapter.normalizeDetailed({
    jobs: [
      { invalid: true },
      {
        id: 1,
        title: 'Software Engineering Intern Summer 2027',
        absolute_url: 'https://employer.test/1',
        location: { name: 'Remote - United States' },
        content: 'Required: TypeScript. Graduating 2027.',
        first_published: '2026-10-01T00:00:00Z',
      },
    ],
  });
  expect(result.jobs).toHaveLength(1);
  expect(result.quarantine).toHaveLength(1);
  expect(result.jobs[0]!.details?.employmentType).toBe('internship');
  expect(result.jobs[0]!.details?.season).toBe('summer');
  expect(result.jobs[0]!.details?.remoteJurisdiction).toContain('United States');
  expect(result.jobs[0]!.postedAt).toBe('2026-10-01T00:00:00.000Z');
  expect(result.jobs[0]!.details?.requirements.items.length).toBeGreaterThan(0);
  expect(() => adapter.normalize({ notJobs: [] })).toThrow();
});
it('does not confuse International or Senior Living with career levels, and retains explicit secondary locations', () => {
  const adapter = new AtsAdapter(source('greenhouse'));
  const jobs = [
    'International Software Engineer',
    'Senior Living Software Engineer',
    'Mid Backend Engineer',
  ].map((title, id) => ({
    id,
    title,
    absolute_url: `https://employer.test/${id}`,
    location: { name: 'Remote' },
    content: 'TypeScript required',
    metadata: [{ name: 'Employment Type', value: 'Full-time' }],
  }));
  const normalized = adapter.normalize({ jobs });
  expect(normalized.map((j) => j.level)).toEqual(['unknown', 'unknown', 'mid']);
  expect(normalized[0]!.details!.employmentType).toBe('full-time');
  const remote = new AtsAdapter(source('ashby')).normalize({
    jobs: [
      {
        id: '1',
        title: 'Engineer',
        jobUrl: 'https://employer.test/1',
        descriptionPlain: 'TypeScript',
        location: 'New York',
        isRemote: true,
        address: { postalAddress: { addressCountry: 'US' } },
        secondaryLocations: [{ location: 'Toronto', address: { addressCountry: 'CA' } }],
      },
    ],
  })[0]!;
  expect(remote.location).toContain('Toronto');
  expect(remote.details!.remoteJurisdiction).toContain('US');
});
it('uses documented SmartRecruiters paging and fixed detail endpoints rather than response ref URLs', async () => {
  const urls: string[] = [];
  const adapter = new AtsAdapter(source('smartrecruiters'), async (url) => {
    urls.push(url);
    const body = url.includes('/postings/1')
      ? {
          id: '1',
          name: 'Engineer',
          company: { identifier: 'fixture' },
          location: { city: 'Paris', country: 'FR', remote: true },
          jobAd: { sections: { jobDescription: { text: 'TypeScript required' } } },
          releasedDate: '2026-10-01',
        }
      : {
          totalFound: 101,
          content: [{ id: '1', name: 'Engineer', ref: 'http://127.0.0.1/private' }],
        };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) };
  });
  const page = await adapter.fetchPage(
    { cursor: null, etag: null, lastModified: null } as SourceState,
    new AbortController().signal,
  );
  expect(page.nextCursor).toBe('1');
  expect(page.jobs[0]!.descriptionText).toContain('TypeScript');
  expect(
    urls.every((u) =>
      u.startsWith('https://api.smartrecruiters.com/v1/companies/fixture/postings'),
    ),
  ).toBe(true);
});
