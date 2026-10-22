/** Optional, credential-free JobSpy process. All library HTTP calls go through the public-source broker. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { z } from 'zod';
import {
  canonicalUrl,
  robotsAllow,
  DiscoveryPolicyError,
  DiscoveryRecordSchema,
  plain,
} from '@rovdo/job-sources';
import type { DiscoveryRead, DiscoveryPage } from '@rovdo/job-sources';

const sites: Record<string, { site: string; host: string }> = {
  'linkedin-jobs': { site: 'linkedin', host: 'linkedin.com' },
  indeed: { site: 'indeed', host: 'indeed.com' },
  glassdoor: { site: 'glassdoor', host: 'glassdoor.com' },
  ziprecruiter: { site: 'zip_recruiter', host: 'ziprecruiter.com' },
  bayt: { site: 'bayt', host: 'bayt.com' },
  naukri: { site: 'naukri', host: 'naukri.com' },
  'google-for-jobs': { site: 'google', host: 'google.com' },
};
export function jobSpyUrl(sourceId: string, value: string): boolean {
  try {
    canonicalUrl(value);
    const u = new URL(value),
      host = sites[sourceId]?.host;
    return (
      !!host &&
      !u.port &&
      (u.hostname === host || u.hostname.endsWith('.' + host)) &&
      !/\/(?:in|pub|login|checkpoint|authwall|uas|oauth|accounts)(?:\/|$)/i.test(u.pathname) &&
      (sourceId !== 'linkedin-jobs' ||
        u.pathname === '/robots.txt' ||
        u.pathname.startsWith('/jobs/'))
    );
  } catch {
    return false;
  }
}
/** Fail closed on restrictions. A user's risk acknowledgment never overrides website controls. */
export function jobSpyRequest(sourceId: string, read: DiscoveryRead) {
  const robots = new Map<string, Promise<string | null>>();
  return async (input: unknown) => {
    const parsed = z
      .strictObject({ method: z.literal('GET'), url: z.string().url().max(4096) })
      .safeParse(input);
    if (!parsed.success || !jobSpyUrl(sourceId, parsed.data.url))
      throw new DiscoveryPolicyError('JOBSPY_POLICY_BLOCKED');
    const u = new URL(parsed.data.url);
    if (!robots.has(u.origin))
      robots.set(
        u.origin,
        (async () => {
          const r = await read(u.origin + '/robots.txt');
          if (r.status === 404) return null;
          if (r.status !== 200) throw new DiscoveryPolicyError('ROBOTS_BLOCKED');
          return r.body.toString('utf8');
        })(),
      );
    const rules = await robots.get(u.origin)!;
    if (rules !== null && !robotsAllow(rules, u.pathname + u.search))
      throw new DiscoveryPolicyError('ROBOTS_BLOCKED');
    const response = await read(u.href);
    if (response.status !== 200) throw new DiscoveryPolicyError(`HTTP_${response.status}`);
    if (
      /captcha|verify (?:you are|your identity)|access denied|cf-chl-/i.test(
        response.body.toString('utf8'),
      )
    )
      throw new DiscoveryPolicyError('CHALLENGE_BLOCKED');
    return response;
  };
}

let queue: Promise<unknown> = Promise.resolve();
/** One bounded subprocess at a time keeps opt-in scraping from monopolizing the desktop. */
export async function runJobSpy(
  enabled: boolean,
  sourceId: string,
  payload: Record<string, unknown>,
  read: DiscoveryRead,
  signal: AbortSignal,
): Promise<DiscoveryPage> {
  if (!enabled) throw new DiscoveryPolicyError('JOBSPY_DISABLED');
  if (!sites[sourceId]) throw new DiscoveryPolicyError('JOBSPY_POLICY_BLOCKED');
  const options = z
    .object({
      query: z.string().max(500),
      location: z.string().max(200).default(''),
      offset: z.number().int().nonnegative().default(0),
    })
    .parse(payload);
  const work = queue
    .catch(() => {})
    .then(async () => {
      if (signal.aborted) throw new DiscoveryPolicyError('CANCELED');
      const broker = jobSpyRequest(sourceId, read);
      const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        // -I ignores PYTHONPATH/user site packages; install python-jobspy in the chosen interpreter's environment.
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key, value]) =>
              /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|LANG|LC_ALL)$/i.test(key) &&
              value !== undefined,
          ),
        );
        const child = spawn('python', ['-I', '-u', join(__dirname, 'jobspy-worker.py')], {
          windowsHide: true,
          shell: false,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let settled = false,
          bytes = 0;
        const lines = createInterface({ input: child.stdout });
        const stop = (error?: Error, result?: Record<string, unknown>[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          lines.close();
          child.kill();
          if (error) reject(error);
          else resolve(result ?? []);
        };
        const abort = () => stop(new DiscoveryPolicyError('CANCELED'));
        const timer = setTimeout(() => stop(new DiscoveryPolicyError('JOBSPY_TIMEOUT')), 55000);
        signal.addEventListener('abort', abort, { once: true });
        child.on('error', () => stop(new DiscoveryPolicyError('JOBSPY_UNAVAILABLE')));
        child.on('exit', () => {
          if (!settled) stop(new DiscoveryPolicyError('JOBSPY_WORKER_FAILED'));
        });
        child.stdin.on('error', () => stop(new DiscoveryPolicyError('JOBSPY_WORKER_FAILED')));
        // Discard third-party diagnostics: tracebacks may contain search payloads or page data.
        child.stderr.on('data', () => {});
        child.stdout.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8_000_000) stop(new DiscoveryPolicyError('RESPONSE_LIMIT'));
        });
        lines.on('line', (line) => {
          if (settled) return;
          void (async () => {
            try {
              const msg = z
                .discriminatedUnion('type', [
                  z.strictObject({
                    type: z.literal('request'),
                    method: z.string(),
                    url: z.string(),
                  }),
                  z.strictObject({
                    type: z.literal('result'),
                    rows: z.array(z.record(z.string(), z.unknown())).max(50),
                  }),
                  z.strictObject({
                    type: z.literal('error'),
                    code: z.enum([
                      'JOBSPY_UNAVAILABLE',
                      'JOBSPY_WORKER_FAILED',
                      'JOBSPY_POLICY_BLOCKED',
                    ]),
                  }),
                ])
                .parse(JSON.parse(line));
              if (msg.type === 'error') return stop(new DiscoveryPolicyError(msg.code));
              if (msg.type === 'result') return stop(undefined, msg.rows);
              const response = await broker({ method: msg.method, url: msg.url });
              if (!settled)
                child.stdin.write(
                  JSON.stringify({
                    status: response.status,
                    headers: response.headers,
                    body: response.body.toString('base64'),
                  }) + '\n',
                );
            } catch (error) {
              stop(
                error instanceof DiscoveryPolicyError
                  ? error
                  : new DiscoveryPolicyError('JOBSPY_WORKER_FAILED'),
              );
            }
          })();
        });
        child.stdin.write(JSON.stringify({ site: sites[sourceId]!.site, ...options }) + '\n');
      });
      return jobSpyPage(sourceId, rows, options);
    });
  queue = work;
  return work;
}

/** Preserve source truth: rows stay unverified and use the existing deterministic normalizer/scorer. */
export function jobSpyPage(
  sourceId: string,
  rows: Record<string, unknown>[],
  payload: { query: string; location: string; offset: number },
): DiscoveryPage {
  let rejected = 0;
  const records = rows.flatMap((raw) => {
    const str = (key: string) => (typeof raw[key] === 'string' ? String(raw[key]) : '');
    const min =
      typeof raw.min_amount === 'number' && Number.isFinite(raw.min_amount) ? raw.min_amount : null;
    const max =
      typeof raw.max_amount === 'number' && Number.isFinite(raw.max_amount) ? raw.max_amount : null;
    const result = DiscoveryRecordSchema.safeParse({
      url: str('job_url_direct') || str('job_url'),
      title: str('title'),
      company: str('company') || null,
      description: plain(str('description')),
      location: str('location'),
      sourceId,
      sourceName: 'JobSpy / ' + sites[sourceId]?.site,
      sourceUrl: str('job_url'),
      kind: 'aggregate',
      postedAt: Number.isFinite(Date.parse(str('date_posted')))
        ? new Date(str('date_posted')).toISOString()
        : null,
      employmentType: str('job_type') || 'unknown',
      workMode: raw.is_remote === true ? 'remote' : 'unknown',
      salary:
        (min !== null || max !== null) && str('currency')
          ? { min, max, currency: str('currency'), interval: str('interval'), source: 'explicit' }
          : null,
    });
    if (!result.success) {
      rejected++;
      return [];
    }
    try {
      canonicalUrl(result.data.url);
      return [result.data];
    } catch {
      rejected++;
      return [];
    }
  });
  return {
    records,
    rejected,
    next: rows.length === 50 ? { ...payload, offset: payload.offset + 50 } : null,
  };
}
