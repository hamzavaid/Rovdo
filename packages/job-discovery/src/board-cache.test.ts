import { expect, it, vi } from 'vitest';
import { CareerStore } from '@rovdo/storage';
import { GlobalDiscoveryEngine } from './global-engine';

it('reuses a due unchanged snapshot after a real conditional 304 response', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const store = new CareerStore(':memory:');
  let conditional = false;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async (_url, options) => {
      conditional = options?.headers?.['if-none-match'] === 'fixture';
      return conditional
        ? { status: 304, headers: { etag: 'fixture' }, body: Buffer.alloc(0) }
        : {
            status: 200,
            headers: { etag: 'fixture' },
            body: Buffer.from(
              JSON.stringify({
                jobs: [
                  {
                    id: 1,
                    title: 'Engineer',
                    absolute_url: 'https://job-boards.greenhouse.io/fixture/jobs/1',
                    content: 'TypeScript required',
                    location: { name: 'Remote' },
                  },
                ],
              }),
            ),
          };
    },
  });
  const feed = { ats: 'greenhouse', tenant: 'fixture', region: 'global' };
  store.global.rememberCompany(
    feed,
    'Fixture',
    'https://job-boards.greenhouse.io/fixture',
    Date.now(),
  );
  store.global.validateCompany(feed, Date.now());
  try {
    const first = engine.start({ sourceIds: ['greenhouse'], overrides: {} });
    for (let n = 0; n < 10 && store.global.run(first).status === 'running'; n++)
      await engine.tick();
    vi.setSystemTime(Date.now() + 3600001);
    const second = engine.start({ sourceIds: ['greenhouse'], overrides: {} });
    for (let n = 0; n < 10 && store.global.run(second).status === 'running'; n++)
      await engine.tick();
    expect(conditional).toBe(true);
    expect(store.global.stats(second).jobs).toBe(1);
    expect(store.global.run(second).status).toBe('completed');
    expect(store.jobCount()).toBe(1);
  } finally {
    await engine.shutdown();
    store.close();
    vi.useRealTimers();
  }
});

it('reuses a fresh complete board snapshot without refetching, reparsing or reingesting it', async () => {
  const store = new CareerStore(':memory:');
  let requests = 0;
  const engine = new GlobalDiscoveryEngine(store, {
    sleep: async () => {},
    transport: async () => {
      requests++;
      return {
        status: 200,
        headers: { etag: 'fixture' },
        body: Buffer.from(
          JSON.stringify([
            {
              id: 'one',
              text: 'Engineer',
              hostedUrl: 'https://jobs.lever.co/fixture/one',
              descriptionPlain: 'TypeScript required',
              categories: { location: 'Remote' },
            },
          ]),
        ),
      };
    },
  });
  const feed = { ats: 'lever', tenant: 'fixture', region: 'global' };
  store.global.rememberCompany(feed, 'Fixture', 'https://jobs.lever.co/fixture', Date.now());
  store.global.validateCompany(feed, Date.now());
  try {
    const cold = engine.start({ sourceIds: ['lever'], overrides: {} });
    for (let n = 0; n < 10 && store.global.run(cold).status === 'running'; n++) await engine.tick();
    expect(store.jobCount()).toBe(1);
    const before = requests;
    const observation = store.jobs()[0]!.discovery!.checkedAt;
    const ingest = vi.spyOn(store, 'ingestDiscoveredAsync');
    const warm = engine.start({ sourceIds: ['lever'], overrides: {} });
    for (let n = 0; n < 10 && store.global.run(warm).status === 'running'; n++) await engine.tick();
    expect(requests).toBe(before);
    expect(ingest).not.toHaveBeenCalled();
    expect(store.global.stats(warm).jobs).toBe(1);
    expect(engine.view().metrics).toMatchObject({
      newJobs: 0,
      updatedJobs: 0,
      knownBoards: 1,
      boardsChecked: 0,
      cacheHits: 1,
    });
    expect(store.jobs()[0]!.discovery!.checkedAt).toBe(observation);
    expect(store.jobs()[0]!.discovery!.availability).toBe('verified');
  } finally {
    await engine.shutdown();
    store.close();
  }
});

it('does not let foreground controls cancel the independent company lane', async () => {
  const store = new CareerStore(':memory:');
  const companies = new GlobalDiscoveryEngine(store, { lane: 'companies' });
  const jobs = new GlobalDiscoveryEngine(store);
  try {
    const id = companies.start({ sourceIds: ['lever'], overrides: {} });
    await expect(jobs.control(id, 'cancel')).rejects.toThrow('WRONG_DISCOVERY_LANE');
    expect(store.global.run(id).status).toBe('running');
  } finally {
    await companies.shutdown();
    await jobs.shutdown();
    store.close();
  }
});
