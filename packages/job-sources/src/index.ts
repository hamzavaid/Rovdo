/**
 * ATS-specific public endpoints, schema validation and normalized job records.
 * Malformed entries are quarantined individually where possible; adapters retain source-specific provenance.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JobSchema, SourceConfigSchema } from '@rovdo/shared';
import type { Job, SourceConfig, SourceState } from '@rovdo/shared';
import { extractRequirements, roleOf } from '@rovdo/career';
import { inspectCareerPage, permittedPage, robotsAllow } from './directory';
export * from './directory';
import { readPublic } from '@rovdo/shared/network';
import type { PublicResponse, ReadOptions } from '@rovdo/shared/network';

const text = z.string().max(200000);
const id = z.union([z.string().min(1).max(200), z.number().int().nonnegative()]);
const gh = z.looseObject({
  id,
  title: text,
  absolute_url: text,
  location: z.object({ name: text }),
  content: text,
  requisition_id: text.nullable().optional(),
  updated_at: text.optional(),
});
const lever = z.looseObject({
  id,
  text,
  hostedUrl: text,
  categories: z.looseObject({ location: text.optional(), commitment: text.optional() }).optional(),
  descriptionPlain: text.optional(),
  description: text.optional(),
  workplaceType: text.optional(),
  createdAt: z.number().optional(),
  salaryRange: z
    .looseObject({
      min: z.number().optional(),
      max: z.number().optional(),
      currency: text,
      interval: text,
    })
    .optional(),
  lists: z.array(z.object({ text, content: text })).optional(),
});
const ashby = z.looseObject({
  id: id.optional(),
  title: text,
  location: text.optional(),
  jobUrl: text,
  descriptionPlain: text,
  isListed: z.boolean().optional(),
  isRemote: z.boolean().optional(),
  workplaceType: text.optional(),
  employmentType: text.optional(),
  publishedAt: text.optional(),
  compensation: z
    .looseObject({
      summaryComponents: z
        .array(
          z.looseObject({
            compensationType: text,
            interval: text.optional(),
            currencyCode: text.nullable().optional(),
            minValue: z.number().nullable().optional(),
            maxValue: z.number().nullable().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
function careerLevel(title: string, commitment: string): Job['level'] {
  if (/\bintern(?:ship)?\b/i.test(`${title} ${commitment}`)) return 'internship';
  if (/\bnew[ -]?grad(?:uate)?\b/i.test(title)) return 'new-grad';
  const level = roleOf(title).level;
  return ['senior', 'staff', 'principal', 'lead'].includes(level)
    ? 'senior'
    : level === 'junior'
      ? 'junior'
      : level === 'mid'
        ? 'mid'
        : 'unknown';
}
export function canonicalUrl(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    !u.hostname.includes('.') ||
    /^(\d|\[)/.test(u.hostname)
  )
    throw new Error('INVALID_JOB_URL');
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|gh_src$|lever-source$|source$|ref$|referrer$)/i.test(key))
      u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href.replace(/\/$/, '');
}
export function plain(value: string): string {
  // ATS HTML is data only. Decode entities before dropping markup, including
  // Greenhouse's entity-encoded descriptions. Never render source HTML.
  let out = value;
  for (let i = 0; i < 2; i++)
    out = out.replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (e) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[
          e
        ]!,
    );
  return out
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/?(?:p|div|li|h[1-6]|br|section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 100000);
}
/** Resolve a supported tenant to its documented public feed; there is no universal ATS search endpoint. */
export function sourceEndpoint(s: SourceConfig): string {
  SourceConfigSchema.parse(s);
  if (s.ats === 'greenhouse')
    return `https://boards-api.greenhouse.io/v1/boards/${s.tenant}/jobs?content=true`;
  if (s.ats === 'lever')
    return `https://${s.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${s.tenant}?mode=json&limit=100`;
  if (s.ats === 'smartrecruiters')
    return `https://api.smartrecruiters.com/v1/companies/${s.tenant}/postings?limit=20&offset=0`;
  if (s.ats === 'jsonld') {
    if (!s.pageUrl || !permittedPage(s.pageUrl) || !s.directoryId)
      throw new Error('PAGE_NOT_APPROVED');
    return s.pageUrl;
  }
  return `https://api.ashbyhq.com/posting-api/job-board/${s.tenant}?includeCompensation=true`;
}
export type Quarantine = { hash: string; code: string; index: number };
export type JobPage = {
  jobs: Job[];
  nextCursor: string | null;
  status: number;
  headers: Record<string, string>;
  returned: number;
  quarantine?: Quarantine[];
};
export class SourceError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number,
    readonly code = 'HTTP_ERROR',
  ) {
    super(code);
  }
}
export interface JobSourceAdapter {
  setReadGate?(gate: (url: string, signal: AbortSignal) => Promise<void>): void;
  fetchPage(state: SourceState, signal: AbortSignal): Promise<JobPage>;
  normalize(raw: unknown): Job[];
  verifyActive(job: Job, signal: AbortSignal): Promise<'open' | 'closed' | 'unknown'>;
}
/** Decode one source protocol and preserve provenance while producing the shared normalized job shape. */
export class AtsAdapter implements JobSourceAdapter {
  private gate: ((url: string, signal: AbortSignal) => Promise<void>) | undefined;
  setReadGate(gate: (url: string, signal: AbortSignal) => Promise<void>) {
    this.gate = gate;
  }
  private async read(url: string, options: ReadOptions = {}) {
    await this.gate?.(url, options.signal ?? new AbortController().signal);
    return this.transport(url, options);
  }
  private readonly observed = new Set<string>();
  constructor(
    readonly source: SourceConfig,
    private readonly transport: (
      url: string,
      options?: ReadOptions,
    ) => Promise<PublicResponse> = readPublic,
  ) {
    SourceConfigSchema.parse(source);
  }
  async fetchPage(state: SourceState, signal: AbortSignal): Promise<JobPage> {
    const url = new URL(sourceEndpoint(this.source));
    if (state.cursor !== null) {
      if (
        !['lever', 'smartrecruiters'].includes(this.source.ats) ||
        !/^\d{1,6}$/.test(state.cursor)
      )
        throw new SourceError(0, 0, 'INVALID_CURSOR');
      url.searchParams.set(this.source.ats === 'lever' ? 'skip' : 'offset', state.cursor);
    }
    const headers: Record<string, string> = {};
    if (
      state.cursor === null &&
      !['lever', 'smartrecruiters', 'jsonld'].includes(this.source.ats)
    ) {
      if (state.etag) headers['if-none-match'] = state.etag;
      if (state.lastModified) headers['if-modified-since'] = state.lastModified;
    }
    if (this.source.ats === 'jsonld') {
      const robots = await this.read(new URL('/robots.txt', url).href, { signal });
      if (
        robots.status !== 404 &&
        (robots.status !== 200 || !robotsAllow(robots.body.toString('utf8'), url.pathname))
      )
        throw new SourceError(robots.status, 0, 'ROBOTS_BLOCKED');
    }
    const response = await this.read(url.href, { headers, signal });
    if (response.status === 304)
      return { jobs: [], nextCursor: null, returned: 0, status: 304, headers: response.headers };
    if (response.status !== 200) {
      const raw = response.headers['retry-after'];
      const numeric = Number(raw);
      const retry = raw
        ? Number.isFinite(numeric)
          ? Math.max(0, numeric * 1000)
          : Math.max(0, Date.parse(raw) - Date.now())
        : 0;
      throw new SourceError(response.status, Number.isFinite(retry) ? retry : 0);
    }
    let payload: unknown;
    try {
      payload =
        this.source.ats === 'jsonld'
          ? {
              jobs: inspectCareerPage(response.body.toString('utf8'), url.href, this.source.company)
                .postings,
            }
          : JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new SourceError(200, 0, 'SCHEMA_DRIFT');
    }
    if (this.source.ats === 'smartrecruiters') {
      const list = z
        .object({
          content: z.array(z.unknown()).max(100),
          totalFound: z.number().int().nonnegative(),
        })
        .parse(payload);
      const details: unknown[] = [];
      for (const item of list.content) {
        const parsed = z.object({ id }).safeParse(item);
        if (!parsed.success) {
          details.push(item);
          continue;
        }
        const detail = await this.read(
          `https://api.smartrecruiters.com/v1/companies/${this.source.tenant}/postings/${encodeURIComponent(String(parsed.data.id))}`,
          { signal },
        );
        if (detail.status !== 200) throw new SourceError(detail.status, 1000, 'DETAIL_UNAVAILABLE');
        try {
          details.push(JSON.parse(detail.body.toString('utf8')));
        } catch {
          details.push({ malformed: true });
        }
      }
      payload = { content: details, totalFound: list.totalFound };
    }
    const normalized = this.normalizeDetailed(payload);
    const jobs = normalized.jobs;
    for (const job of jobs) this.observed.add(job.sourceJobId);
    const count = Array.isArray(payload)
      ? payload.length
      : this.source.ats === 'smartrecruiters'
        ? z.object({ content: z.array(z.unknown()) }).parse(payload).content.length
        : z.object({ jobs: z.array(z.unknown()) }).parse(payload).jobs.length;
    const next = Number(state.cursor ?? 0) + count;
    const nextCursor =
      this.source.ats === 'lever' && count === 100
        ? String(next)
        : this.source.ats === 'smartrecruiters' &&
            count &&
            next < z.object({ totalFound: z.number() }).parse(payload).totalFound
          ? String(next)
          : null;
    return {
      jobs,
      nextCursor,
      returned: count,
      status: 200,
      headers: response.headers,
      quarantine: normalized.quarantine,
    };
  }
  normalize(payload: unknown): Job[] {
    return this.normalizeDetailed(payload).jobs;
  }
  normalizeDetailed(payload: unknown): { jobs: Job[]; quarantine: Quarantine[] } {
    try {
      const records =
        this.source.ats === 'smartrecruiters'
          ? z.object({ content: z.array(z.unknown()).max(10000) }).parse(payload).content
          : this.source.ats === 'lever'
            ? z.array(z.unknown()).max(10000).parse(payload)
            : z.object({ jobs: z.array(z.unknown()).max(10000) }).parse(payload).jobs;
      const quarantine: Quarantine[] = [];
      const jobs = records.flatMap((raw, index): Job[] => {
        try {
          const s = this.source;
          let title: string;
          let url: string;
          let sourceId: string;
          let location: string;
          let description: string;
          let mode: string;
          let commitment = '';
          let posted: string | null = null;
          let updated: string | null = null;
          let requisition: string | null = null;
          let salary: Job['salary'] = null;
          let country = '';
          let extraCountries: string[] = [];
          const timestamp = (v: string | number | null | undefined) =>
            v !== null && v !== undefined && Number.isFinite(new Date(v).getTime())
              ? new Date(v).toISOString()
              : null;
          if (s.ats === 'greenhouse') {
            const r = gh.parse(raw);
            title = r.title;
            url = r.absolute_url;
            sourceId = String(r.id);
            location = r.location.name;
            description = plain(r.content);
            mode = /remote/i.test(location) ? 'remote' : 'unknown';
            updated = timestamp(r.updated_at);
            posted = timestamp((raw as { first_published?: string }).first_published);
            requisition = r.requisition_id ?? null;
            const metadata = z
              .array(z.looseObject({ name: text, value: z.unknown() }))
              .max(100)
              .safeParse((raw as { metadata?: unknown }).metadata);
            const employment = metadata.success
              ? metadata.data.find((m) => /employment[ _-]?type/i.test(m.name))?.value
              : null;
            commitment = typeof employment === 'string' ? employment : '';
          } else if (s.ats === 'lever') {
            const r = lever.parse(raw);
            title = r.text;
            url = r.hostedUrl;
            sourceId = String(r.id);
            location = r.categories?.location ?? '';
            description = plain(
              [
                r.descriptionPlain ?? r.description ?? '',
                ...(r.lists ?? []).map((l) => `${l.text}: ${l.content}`),
              ].join('\n'),
            );
            mode = r.workplaceType ?? (/remote/i.test(location) ? 'remote' : 'unknown');
            commitment = r.categories?.commitment ?? '';
            posted = timestamp(r.createdAt);
            country = String((raw as { country?: string }).country ?? '').slice(0, 100);
            if (r.salaryRange)
              salary = {
                min: r.salaryRange.min ?? null,
                max: r.salaryRange.max ?? null,
                currency: r.salaryRange.currency,
                interval: r.salaryRange.interval,
                source: 'explicit',
              };
          } else if (s.ats === 'smartrecruiters') {
            const r = z
              .looseObject({
                id,
                name: text,
                location: z
                  .looseObject({
                    city: text.optional(),
                    region: text.optional(),
                    country: text.optional(),
                    remote: z.boolean().optional(),
                  })
                  .optional(),
                company: z.looseObject({ identifier: text }).optional(),
                jobAd: z.object({ sections: z.record(z.string(), z.object({ text })) }).optional(),
                releasedDate: text.optional(),
                typeOfEmployment: z.object({ label: text }).optional(),
              })
              .parse(raw);
            if (r.company && r.company.identifier.toLowerCase() !== s.tenant.toLowerCase())
              throw new Error('EMPLOYER_MISMATCH');
            title = r.name;
            sourceId = String(r.id);
            url = `https://jobs.smartrecruiters.com/${s.tenant}/${sourceId}`;
            location = [r.location?.city, r.location?.region, r.location?.country]
              .filter(Boolean)
              .join(', ');
            country = r.location?.country ?? '';
            description = plain(
              Object.values(r.jobAd?.sections ?? {})
                .map((x) => x.text)
                .join('\n'),
            );
            mode = r.location?.remote ? 'remote' : 'unknown';
            posted = timestamp(r.releasedDate);
            commitment = r.typeOfEmployment?.label ?? '';
          } else if (s.ats === 'jsonld') {
            const r = z
              .looseObject({
                title: text,
                url: text,
                description: text,
                datePosted: text.optional(),
                employmentType: z.union([text, z.array(text)]).optional(),
                jobLocationType: text.optional(),
                applicantLocationRequirements: z.unknown().optional(),
                jobLocation: z.unknown().optional(),
                baseSalary: z.unknown().optional(),
                validThrough: text.optional(),
              })
              .parse(raw);
            if (!s.pageUrl || new URL(r.url).origin !== new URL(s.pageUrl).origin)
              throw new Error('ORIGIN_MISMATCH');
            title = r.title;
            url = r.url;
            sourceId = sha256(canonicalUrl(url));
            description = plain(r.description);
            posted = timestamp(r.datePosted);
            commitment = String(r.employmentType ?? '');
            const places = Array.isArray(r.jobLocation) ? r.jobLocation : [r.jobLocation];
            location = places
              .flatMap((p) => {
                const result = z
                  .object({
                    address: z.object({
                      addressLocality: text.optional(),
                      addressRegion: text.optional(),
                      addressCountry: text.optional(),
                    }),
                  })
                  .safeParse(p);
                return result.success ? [Object.values(result.data.address).join(', ')] : [];
              })
              .join('; ');
            const jurisdictions = Array.isArray(r.applicantLocationRequirements)
              ? r.applicantLocationRequirements
              : [r.applicantLocationRequirements];
            if (r.jobLocationType === 'TELECOMMUTE')
              location =
                'Remote ' +
                jurisdictions
                  .flatMap((x) => {
                    const p = z.object({ name: text }).safeParse(x);
                    return p.success ? [p.data.name] : [];
                  })
                  .join(', ');
            mode = r.jobLocationType === 'TELECOMMUTE' ? 'remote' : location ? 'onsite' : 'unknown';
            const pay = z
              .object({
                currency: text,
                value: z.object({
                  minValue: z.number().optional(),
                  maxValue: z.number().optional(),
                  value: z.number().optional(),
                  unitText: text,
                }),
              })
              .safeParse(r.baseSalary);
            if (pay.success)
              salary = {
                min: pay.data.value.minValue ?? pay.data.value.value ?? null,
                max: pay.data.value.maxValue ?? pay.data.value.value ?? null,
                currency: pay.data.currency,
                interval: pay.data.value.unitText,
                source: 'explicit',
              };
          } else {
            const r = ashby.parse(raw);
            if (r.isListed === false) return [];
            title = r.title;
            url = r.jobUrl;
            sourceId = String(r.id ?? sha256(canonicalUrl(r.jobUrl)));
            const secondary = z
              .array(
                z.looseObject({
                  location: text.optional(),
                  address: z.looseObject({ addressCountry: text.optional() }).optional(),
                }),
              )
              .max(20)
              .safeParse((raw as { secondaryLocations?: unknown }).secondaryLocations);
            extraCountries = secondary.success
              ? secondary.data.flatMap((x) =>
                  x.address?.addressCountry ? [x.address.addressCountry] : [],
                )
              : [];
            location = [
              r.location ?? '',
              ...(secondary.success ? secondary.data.map((x) => x.location ?? '') : []),
            ]
              .filter(Boolean)
              .join('; ')
              .slice(0, 500);
            description = r.descriptionPlain.slice(0, 100000);
            mode = r.isRemote ? 'remote' : (r.workplaceType?.toLowerCase() ?? 'unknown');
            commitment = r.employmentType ?? '';
            posted = timestamp(r.publishedAt);
            country = String(
              (raw as { address?: { postalAddress?: { addressCountry?: string } } }).address
                ?.postalAddress?.addressCountry ?? '',
            ).slice(0, 100);
            const salaryPart = r.compensation?.summaryComponents?.find(
              (c) => c.compensationType === 'Salary',
            );
            if (salaryPart?.currencyCode && salaryPart.interval)
              salary = {
                min: salaryPart.minValue ?? null,
                max: salaryPart.maxValue ?? null,
                currency: salaryPart.currencyCode,
                interval: salaryPart.interval,
                source: 'explicit',
              };
          }
          const canonical = canonicalUrl(url);
          const now = Date.now();
          const hash = sha256(JSON.stringify(raw));
          const key = `${s.ats}:${s.tenant}:${sourceId}`;
          return [
            JobSchema.parse({
              id: key,
              source: s.ats,
              tenant: s.tenant,
              sourceJobId: sourceId,
              requisitionId: requisition,
              canonicalUrl: canonical,
              company: s.company,
              title: plain(title),
              location: plain(location),
              descriptionText: description,
              workMode: ['remote', 'hybrid', 'onsite'].includes(mode.toLowerCase())
                ? mode.toLowerCase()
                : 'unknown',
              level: careerLevel(title, commitment),
              postedAt: posted,
              updatedAt: updated,
              firstSeenAt: now,
              lastSeenAt: now,
              activeStatus: 'open',
              salary,
              contentSha256: sha256(
                JSON.stringify([
                  title,
                  description,
                  location,
                  mode,
                  commitment,
                  salary,
                  posted,
                  country,
                ]),
              ),
              rawSha256: hash,
              parserVersion: 'ats-v1',
              duplicateGroup: null,
              details: {
                employmentType: /\bintern(?:ship)?\b/i.test(`${title} ${commitment}`)
                  ? 'internship'
                  : /part.?time/i.test(commitment)
                    ? 'part-time'
                    : /full.?time/i.test(commitment)
                      ? 'full-time'
                      : /contract/i.test(commitment)
                        ? 'contract'
                        : /temp/i.test(commitment)
                          ? 'temporary'
                          : 'unknown',
                roleFamily: roleOf(title).family,
                remoteJurisdiction:
                  /remote/i.test(`${mode} ${location}`) && location
                    ? [
                        ...new Set(
                          [
                            country,
                            ...extraCountries,
                            plain(location)
                              .replace(/remote\s*[-:?]?\s*/i, '')
                              .trim(),
                          ].filter(Boolean),
                        ),
                      ].slice(0, 20)
                    : [],
                season:
                  /\b(summer|spring|fall|winter)\b/i
                    .exec(`${title} ${description.slice(0, 200)}`)?.[1]
                    ?.toLowerCase() ?? 'unknown',
                country,
                requirements: extractRequirements(description, title),
              },
              provenance: [
                {
                  sourceId: s.id,
                  sourceKey: key,
                  url,
                  collectedAt: now,
                  rawSha256: hash,
                  fields: {
                    title: s.ats === 'lever' ? 'text' : 'title',
                    description: s.ats === 'greenhouse' ? 'content' : 'descriptionPlain',
                    eligibility: 'explicit description excerpts only',
                  },
                },
              ],
            }),
          ];
        } catch {
          quarantine.push({ hash: sha256(JSON.stringify(raw)), code: 'INVALID_RECORD', index });
          return [];
        }
      });
      if (records.length && !jobs.length && quarantine.length)
        throw new SourceError(200, 0, 'SCHEMA_DRIFT');
      return { jobs, quarantine };
    } catch {
      throw new SourceError(200, 0, 'SCHEMA_DRIFT');
    }
  }
  async verifyActive(job: Job, signal: AbortSignal): Promise<'open' | 'closed' | 'unknown'> {
    // Public listing evidence can prove open; absence from one snapshot cannot
    // safely prove closed. The discovery store applies the removal grace rule.
    return !signal.aborted &&
      job.source === this.source.ats &&
      job.tenant === this.source.tenant &&
      this.observed.has(job.sourceJobId)
      ? 'open'
      : 'unknown';
  }
}

export * from './registry';

export * from './global-adapters';
