/** Public-feed/index decoding. Individual malformed records are isolated; snippets never become invented job descriptions. */
import { z } from 'zod';
import { JobSchema } from '@rovdo/shared';
import type { Job } from '@rovdo/shared';
import type { PublicResponse } from '@rovdo/shared/network';
import { extractRequirements, roleOf } from '@rovdo/career';
import { canonicalUrl, plain, sha256 } from './index';
import { DISCOVERY_SOURCES } from './registry';
export const DiscoveryRecordSchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().trim().min(1).max(500),
  company: z.string().trim().max(200).nullable(),
  location: z.string().max(500).default(''),
  description: z.string().max(100000).default(''),
  postedAt: z.string().nullable().default(null),
  employmentType: z.string().default('unknown'),
  workMode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).default('unknown'),
  requisitionId: z.string().max(200).nullable().default(null),
  salary: JobSchema.shape.salary.default(null),
  sourceId: z.string(),
  sourceName: z.string(),
  sourceUrl: z.string().url(),
  kind: z.enum(['aggregate', 'repository', 'index', 'import']).default('aggregate'),
  exportAllowed: z.boolean().default(true),
});
export type DiscoveryRecord = z.infer<typeof DiscoveryRecordSchema>;
export type DiscoveryPage = {
  records: DiscoveryRecord[];
  next: Record<string, unknown> | null;
  rejected: number;
};
export type DiscoveryRead = (
  url: string,
  headers?: Record<string, string>,
) => Promise<PublicResponse>;
/** Safe terminal codes, never raw provider or TLS diagnostic text. */
export class DiscoveryPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export class DiscoveryHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs = 0,
  ) {
    super('DISCOVERY_HTTP_ERROR');
  }
}
const string = (x: unknown) => (typeof x === 'string' ? x : '');
const date = (x: unknown) => {
  const n = typeof x === 'number' ? x * 1000 : Date.parse(string(x));
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
const pageRows = (rows: unknown[], payload: Record<string, unknown>) => {
  const offset = Number(payload.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('INVALID_CURSOR');
  return {
    rows: rows.slice(offset, offset + 100),
    next: offset + 100 < rows.length ? { ...payload, offset: offset + 100 } : null,
  };
};
/** HTML/Markdown tables retain the application-column URL, not the company homepage. */
export function parseGithubListings(text: string) {
  const result: {
    url: string;
    title: string;
    company: string | null;
    location: string;
    description: string;
  }[] = [];
  const clean = (s: string) =>
    plain(s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
      .replace(/<[^>]*>/g, '')
      .trim();
  const add = (cells: string[]) => {
    if (cells.length < 4) return;
    const links = [
      ...cells[3]!.matchAll(/href=["'](https:\/\/[^"']+)|\]\((https:\/\/[^)]+)\)/gi),
    ].map((m) => m[1] ?? m[2]!);
    const url = links[0];
    const title = clean(cells[1]!),
      rawCompany = clean(cells[0]!);
    const company = /^(?:[\u21b3\u21aa\u2192\u2193?\s-]+|n\/a|unknown)?$/i.test(rawCompany)
      ? null
      : rawCompany;
    if (url && title && !/\uD83D\uDD12|closed|no longer/i.test(cells[3]!))
      result.push({ url, title, company, location: clean(cells[2]!), description: '' });
  };
  for (const row of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    add([...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]!));
  for (const line of text.split(/\r?\n/))
    if (line.trim().startsWith('|'))
      add(
        line
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((s) => s.trim()),
      );
  return result;
}
export async function fetchDiscoveryPage(
  sourceId: string,
  payload: Record<string, unknown>,
  read: DiscoveryRead,
): Promise<DiscoveryPage> {
  const source = DISCOVERY_SOURCES.find((s) => s.id === sourceId);
  if (!source) throw new Error('UNKNOWN_SOURCE');
  const decode = async (url: string, headers?: Record<string, string>) => {
    const response = await read(url, headers);
    if (response.status !== 200) {
      const retry = response.headers['retry-after'];
      throw new DiscoveryHttpError(
        response.status,
        retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000 : 0,
      );
    }
    return response.body.toString('utf8');
  };
  let raw: unknown[];
  let next: Record<string, unknown> | null;
  if (source.adapter === 'himalayas') {
    const url = new URL(
      payload.query ? 'https://himalayas.app/jobs/api/search' : 'https://himalayas.app/jobs/api',
    );
    if (payload.query) {
      url.searchParams.set('q', String(payload.query));
      url.searchParams.set('page', String(payload.page ?? 1));
    }
    url.searchParams.set('limit', '20');
    if (payload.cursor) url.searchParams.set('cursor', String(payload.cursor));
    const data = z
      .object({ jobs: z.array(z.unknown()), nextCursor: z.string().optional() })
      .parse(JSON.parse(await decode(url.href)));
    raw = data.jobs;
    next = data.nextCursor
      ? { ...payload, cursor: data.nextCursor }
      : payload.query && data.jobs.length
        ? { ...payload, page: Number(payload.page ?? 1) + 1 }
        : null;
  } else if (source.adapter === 'remotive') {
    const data = z
      .object({ jobs: z.array(z.unknown()) })
      .parse(JSON.parse(await decode('https://remotive.com/api/remote-jobs')));
    const page = pageRows(data.jobs, payload);
    raw = page.rows;
    next = page.next;
  } else if (source.adapter === 'github-list') {
    const path = new URL(source.url).pathname.split('/').filter(Boolean);
    const response = await decode(`https://api.github.com/repos/${path[0]}/${path[1]}/readme`, {
      accept: 'application/vnd.github.raw+json',
    });
    let text = response;
    if (response.trim().startsWith('{')) {
      const r = z
        .object({ content: z.string(), encoding: z.literal('base64') })
        .parse(JSON.parse(response));
      text = Buffer.from(r.content, 'base64').toString('utf8');
    }
    const page = pageRows(parseGithubListings(text), payload);
    raw = page.rows;
    next = page.next;
  } else if (source.adapter === 'wwr') {
    const xml = await decode('https://weworkremotely.com/remote-jobs.rss');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('INVALID_FEED');
    const entries = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
      const field = (name: string) =>
        new RegExp(String.raw`<${name}[^>]*>([\s\S]*?)<\/${name}>`, 'i')
          .exec(m[1]!)?.[1]
          ?.replace(/^<!\[CDATA\[|\]\]>$/g, '') ?? '';
      const heading = plain(field('title'));
      const [company, ...title] = heading.split(': ');
      return {
        company: title.length ? company : null,
        title: title.join(': ') || heading,
        url: field('link'),
        description: plain(field('description')),
        location: 'Remote',
        postedAt: date(field('pubDate')),
      };
    });
    const page = pageRows(entries, payload);
    raw = page.rows;
    next = page.next;
  } else if (source.adapter === 'index') {
    const endpoint = new URL(String(payload.indexUrl));
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error('INDEX_CONFIGURATION');
    endpoint.searchParams.set(
      'q',
      (sourceId === 'web-index' ? '' : `site:${new URL(source.url).hostname} `) +
        String(payload.query),
    );
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('pageno', String(payload.page ?? 1));
    const data = z
      .object({ results: z.array(z.unknown()) })
      .parse(JSON.parse(await decode(endpoint.href)));
    raw = data.results;
    next = raw.length ? { ...payload, page: Number(payload.page ?? 1) + 1 } : null;
  } else throw new Error('SOURCE_NOT_IMPLEMENTED');
  const records: DiscoveryRecord[] = [];
  let rejected = 0;
  for (const value of raw) {
    try {
      const r = z.record(z.string(), z.unknown()).parse(value);
      let projected: Record<string, unknown>;
      if (source.adapter === 'himalayas') {
        const locations = Array.isArray(r.locationRestrictions)
          ? r.locationRestrictions
              .map((x) =>
                typeof x === 'string'
                  ? x
                  : typeof x === 'object' && x && 'name' in x
                    ? String(x.name)
                    : '',
              )
              .filter(Boolean)
          : [];
        const salary =
          (typeof r.minSalary === 'number' || typeof r.maxSalary === 'number') &&
          typeof r.currency === 'string'
            ? {
                min: r.minSalary ?? null,
                max: r.maxSalary ?? null,
                currency: r.currency,
                interval: string(r.salaryPeriod) || 'unknown',
                source: 'explicit',
              }
            : null;
        projected = {
          url: r.applicationLink,
          title: r.title,
          company: r.companyName,
          description: plain(string(r.description)),
          location: locations.join(', '),
          postedAt: date(r.pubDate),
          salary,
          employmentType: string(r.employmentType),
          workMode: 'remote',
          exportAllowed: false,
        };
      } else if (source.adapter === 'remotive')
        projected = {
          url: r.url,
          title: r.title,
          company: r.company_name,
          description:
            plain(string(r.description)) +
            (r.salary ? `\nPublished compensation: ${string(r.salary)}` : ''),
          location: string(r.candidate_required_location),
          postedAt: date(r.publication_date),
          employmentType: string(r.job_type),
          workMode: 'remote',
          exportAllowed: false,
        };
      else if (source.adapter === 'index')
        projected = {
          url: r.url,
          title: r.title,
          company: null,
          description: '',
          location: '',
          kind: 'index',
        };
      else
        projected = { ...r, kind: source.adapter === 'github-list' ? 'repository' : 'aggregate' };
      const record = DiscoveryRecordSchema.parse({
        sourceId,
        sourceName: source.name,
        sourceUrl: source.url,
        ...projected,
      });
      canonicalUrl(record.url);
      if (source.adapter === 'index' && sourceId !== 'web-index') {
        const host = new URL(record.url).hostname,
          expected = new URL(source.url).hostname.replace(/^www\./, '');
        if (host !== expected && !host.endsWith('.' + expected)) throw new Error('INDEX_SCOPE');
      }
      records.push(record);
    } catch {
      rejected++;
    }
  }
  return { records, next, rejected };
}
/** Sufficiently complete records enter existing scoring; unstructured snippets remain discoveries only. */
export function normalizeDiscoveryJob(
  record: DiscoveryRecord,
  source: { id: string; tenant: string },
  runId: string,
  now: number,
): Job | null {
  if (
    !record.company ||
    !record.description.trim() ||
    record.kind === 'index' ||
    record.kind === 'repository'
  )
    return null;
  const url = canonicalUrl(record.url);
  const role = roleOf(record.title);
  const type = record.employmentType.toLowerCase().replace(/_/g, '-');
  const employmentType = /intern/.test(type)
    ? 'internship'
    : /full/.test(type)
      ? 'full-time'
      : /part/.test(type)
        ? 'part-time'
        : /contract/.test(type)
          ? 'contract'
          : /temporary/.test(type)
            ? 'temporary'
            : 'unknown';
  const rawHash = sha256(JSON.stringify(record));
  const key = sha256(url);
  return JobSchema.parse({
    id: `discovered:${key}`,
    source:
      record.kind === 'import' ||
      DISCOVERY_SOURCES.find((s) => s.id === record.sourceId)?.adapter === 'jobspy'
        ? 'jobspy'
        : 'public-api',
    tenant: source.tenant,
    sourceJobId: key,
    requisitionId: record.requisitionId,
    canonicalUrl: url,
    company: record.company,
    title: record.title,
    location: record.location,
    workMode: record.workMode,
    level: /intern/i.test(record.title)
      ? 'internship'
      : /senior|staff|principal/.test(role.level)
        ? 'senior'
        : ['junior', 'mid'].includes(role.level)
          ? role.level
          : 'unknown',
    descriptionText: record.description,
    postedAt: record.postedAt,
    updatedAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    activeStatus: 'unknown',
    salary: record.salary,
    contentSha256: sha256(
      [
        record.title,
        record.description,
        record.location,
        record.workMode,
        record.employmentType,
        record.postedAt,
        JSON.stringify(record.salary),
      ].join('\n'),
    ),
    rawSha256: rawHash,
    parserVersion: 'ats-v1',
    duplicateGroup: null,
    details: {
      employmentType,
      roleFamily: role.family,
      remoteJurisdiction: record.location ? [record.location] : [],
      season: /summer/i.test(record.title)
        ? 'summer'
        : /spring/i.test(record.title)
          ? 'spring'
          : /fall|autumn/i.test(record.title)
            ? 'fall'
            : /winter/i.test(record.title)
              ? 'winter'
              : 'unknown',
      country: '',
      requirements: extractRequirements(record.description, record.title),
    },
    provenance: [
      {
        sourceId: source.id,
        sourceKey: key,
        url: record.url,
        collectedAt: now,
        rawSha256: rawHash,
        fields: {
          registryId: record.sourceId,
          sourceName: record.sourceName,
          sourceUrl: record.sourceUrl,
          attributionUrl: record.url,
          exportAllowed: String(record.exportAllowed),
          availability: 'unverified',
        },
      },
    ],
    discovery: {
      kind: record.kind,
      availability: 'unverified',
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      attributionUrl: record.url,
      checkedAt: now,
      runId,
      exportAllowed: record.exportAllowed,
    },
  });
}
