import { expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { jobSpyRequest, runJobSpy, jobSpyPage } from './jobspy';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

test('broker permits only public job GETs and never personal profiles, credentials or proxies', async () => {
  const calls: string[] = [];
  const read = async (url: string) => {
    calls.push(url);
    return {
      status: 200,
      headers: {},
      body: Buffer.from(
        url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /jobs/' : 'public jobs',
      ),
    };
  };
  const request = jobSpyRequest('linkedin-jobs', read);
  await expect(
    request({ method: 'GET', url: 'https://www.linkedin.com/jobs/search/?keywords=rust' }),
  ).resolves.toMatchObject({ status: 200 });
  for (const input of [
    { method: 'GET', url: 'https://www.linkedin.com/in/person' },
    { method: 'POST', url: 'https://www.linkedin.com/jobs/search/' },
    { method: 'GET', url: 'https://127.0.0.1/jobs/' },
    { method: 'GET', url: 'https://evil.example/jobs/' },
    { method: 'GET', url: 'https://user:pass@www.linkedin.com/jobs/' },
    { method: 'GET', url: 'https://www.linkedin.com/jobs/', proxies: ['https://proxy.example'] },
  ])
    await expect(request(input)).rejects.toThrow('JOBSPY_POLICY_BLOCKED');
  expect(calls).toHaveLength(2);
});

test('robots restrictions and access challenges terminate collection without retrying', async () => {
  let calls = 0;
  const request = jobSpyRequest('linkedin-jobs', async () => {
    calls++;
    return { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow: /jobs/') };
  });
  await expect(
    request({ method: 'GET', url: 'https://www.linkedin.com/jobs/search/' }),
  ).rejects.toThrow('ROBOTS_BLOCKED');
  expect(calls).toBe(1);
  const blocked = jobSpyRequest('linkedin-jobs', async (url) => ({
    status: 200,
    headers: {},
    body: Buffer.from(
      url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : 'Verify you are human CAPTCHA',
    ),
  }));
  await expect(
    blocked({ method: 'GET', url: 'https://www.linkedin.com/jobs/search/' }),
  ).rejects.toThrow('CHALLENGE_BLOCKED');
});

test('disabled JobSpy never launches a subprocess', async () => {
  await expect(
    runJobSpy(
      false,
      'linkedin-jobs',
      {},
      async () => {
        throw new Error('network must not run');
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('JOBSPY_DISABLED');
});

test('worker uses an isolated interpreter, brokered GET and validated unverified page records', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  const kill = vi.fn();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  let messages = 0;
  stdin.on('data', (data: Buffer) => {
    const input = JSON.parse(data.toString());
    messages++;
    setImmediate(() => {
      if (messages === 1) {
        expect(input.site).toBe('linkedin');
        stdout.write(
          JSON.stringify({
            type: 'request',
            method: 'GET',
            url: 'https://www.linkedin.com/jobs/search/?keywords=rust',
          }) + '\n',
        );
      } else {
        expect(input.status).toBe(200);
        stdout.write(
          JSON.stringify({
            type: 'result',
            rows: [
              {
                title: 'Engineer',
                company: 'Sample',
                job_url: 'https://www.linkedin.com/jobs/view/1',
                job_url_direct: 'https://jobs.example.com/1',
                description: 'Rust required',
                min_amount: 100000,
                currency: 'USD',
                interval: 'yearly',
              },
            ],
          }) + '\n',
        );
      }
    });
  });
  const page = await runJobSpy(
    true,
    'linkedin-jobs',
    { query: 'Rust jobs' },
    async () => ({ status: 200, headers: {}, body: Buffer.from('User-agent: *\nAllow: /') }),
    new AbortController().signal,
  );
  expect(page.records[0]).toMatchObject({
    url: 'https://jobs.example.com/1',
    kind: 'aggregate',
    title: 'Engineer',
    salary: { min: 100000, max: null },
  });
  expect(spawn).toHaveBeenLastCalledWith(
    'python',
    ['-I', '-u', expect.stringContaining('jobspy-worker.py')],
    expect.objectContaining({ shell: false, windowsHide: true }),
  );
  expect(kill).toHaveBeenCalledOnce();
});

test('worker handles missing dependencies and rejects malformed rows without inventing fields', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  stdin.on('data', () =>
    setImmediate(() => stdout.write('{"type":"error","code":"JOBSPY_UNAVAILABLE"}\n')),
  );
  await expect(
    runJobSpy(
      true,
      'linkedin-jobs',
      { query: 'Rust' },
      async () => {
        throw new Error('No network');
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('JOBSPY_UNAVAILABLE');
  const page = jobSpyPage(
    'linkedin-jobs',
    [
      { title: 'No URL' },
      { title: 'Engineer', company: 'Sample', job_url: 'https://jobs.example.com/1' },
    ],
    { query: 'Rust', location: '', offset: 0 },
  );
  expect(page.rejected).toBe(1);
  expect(page.records[0]!.description).toBe('');
  expect(page.records[0]!.postedAt).toBeNull();
  expect(page.next).toBeNull();
});
