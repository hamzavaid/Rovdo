import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { discoverEmployers } from './employers';
it('validates additional public feeds with provenance, robots and no restricted-platform or redirect bypass', async () => {
  const store = new CareerStore(':memory:'); const urls: string[] = [];
  const transport = async (url: string) => { urls.push(url); return { status: 200, headers: {}, body: Buffer.from(url.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /private' : url.includes('ashbyhq') ? '{"jobs":[]}' : '<a href="https://jobs.ashbyhq.com/fixture">Careers</a>') }; };
  try {
    await discoverEmployers(store, { url: 'https://employer.test/careers', company: 'Fixture', policyUrl: 'https://employer.test/policy', permitted: true }, new AbortController().signal, transport);
    expect(store.directory()[0]!.policy).toBe('approved'); expect(store.directory()[0]!.responseHash).toHaveLength(64);
    const before = urls.length;
    await expect(discoverEmployers(store, { url: 'https://linkedin.com/jobs', company: 'Fixture', policyUrl: 'https://employer.test/policy', permitted: true }, new AbortController().signal, transport)).rejects.toThrow();
    expect(urls).toHaveLength(before);
    await expect(discoverEmployers(store, { url: 'https://employer.test/private', company: 'Fixture', policyUrl: 'https://employer.test/policy', permitted: true }, new AbortController().signal, transport)).rejects.toThrow();
  } finally { store.close(); }
});
