import { expect, it } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { discoverEmployers, refreshEmployers } from './employers';
import { EMPLOYERS } from '@rovdo/job-sources';
it('revalidates expired approved feed metadata but never refreshes opted-out or blocked sources', async () => {
  const store = new CareerStore(':memory:'); let reads = 0;
  try {
    store.seedDirectory([{ ...EMPLOYERS[0]!, refreshAfter: '2020-01-01T00:00:00Z' }, { ...EMPLOYERS[1]!, policy: 'blocked' }]);
    await refreshEmployers(store, new AbortController().signal, async () => { reads++; return { status: 200, headers: {}, body: Buffer.from('{"jobs":[]}') }; });
    expect(reads).toBe(1); expect(Date.parse(store.directory().find((e) => e.id === 'figma')!.refreshAfter)).toBeGreaterThan(Date.now());
    store.enableDirectory(); const source = store.sources()[0]!.config; store.saveSource({ ...source, enabled: false });
    store.reviewDirectory({ ...store.directory().find((e) => e.id === 'figma')!, refreshAfter: '2020-01-01T00:00:00Z' });
    await refreshEmployers(store, new AbortController().signal, async () => { throw new Error('Opt-out must avoid requests'); });
    expect(reads).toBe(1);
  } finally { store.close(); }
});
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
