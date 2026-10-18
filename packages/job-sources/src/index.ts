import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JobSchema, SourceConfigSchema } from '@rovdo/shared';
import type { Job, SourceConfig, SourceState } from '@rovdo/shared';
import { readPublic } from '@rovdo/shared/network';
import type { PublicResponse, ReadOptions } from '@rovdo/shared/network';

const text = z.string().max(200000); const id = z.union([z.string().min(1).max(200), z.number().int().nonnegative()]);
const gh = z.looseObject({ id, title: text, absolute_url: text, location: z.object({ name: text }), content: text, requisition_id: text.nullable().optional(), updated_at: text.optional() });
const lever = z.looseObject({ id, text, hostedUrl: text, categories: z.looseObject({ location: text.optional(), commitment: text.optional() }).optional(), descriptionPlain: text.optional(), description: text.optional(), workplaceType: text.optional(), createdAt: z.number().optional(), salaryRange: z.looseObject({ min: z.number().optional(), max: z.number().optional(), currency: text, interval: text }).optional(), lists: z.array(z.object({ text, content: text })).optional() });
const ashby = z.looseObject({ id: id.optional(), title: text, location: text.optional(), jobUrl: text, descriptionPlain: text, isListed: z.boolean().optional(), isRemote: z.boolean().optional(), workplaceType: text.optional(), employmentType: text.optional(), publishedAt: text.optional(), compensation: z.looseObject({ summaryComponents: z.array(z.looseObject({ compensationType: text, interval: text.optional(), currencyCode: text.nullable().optional(), minValue: z.number().nullable().optional(), maxValue: z.number().nullable().optional() })).optional() }).optional() });
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export function canonicalUrl(value: string): string {
  const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || /^(\d|\[)/.test(u.hostname)) throw new Error('INVALID_JOB_URL');
  u.hash = ''; for (const key of [...u.searchParams.keys()]) if (/^(utm_|gh_src$|lever-source$|source$|ref$|referrer$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort(); return u.href.replace(/\/$/, '');
}
export function plain(value: string): string {
  // ATS HTML is data only. Decode entities before dropping markup, including
  // Greenhouse's entity-encoded descriptions. Never render source HTML.
  let out = value;
  for (let i = 0; i < 2; i++) out = out.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[e]!);
  return out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<\/?(?:p|div|li|h[1-6]|br|section)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').split(/\r?\n/).map((line) => line.replace(/[\t ]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 100000);
}
export function sourceEndpoint(s: SourceConfig): string {
  SourceConfigSchema.parse(s);
  if (s.ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${s.tenant}/jobs?content=true`;
  if (s.ats === 'lever') return `https://${s.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${s.tenant}?mode=json&limit=100`;
  return `https://api.ashbyhq.com/posting-api/job-board/${s.tenant}?includeCompensation=true`;
}
export type JobPage = { jobs: Job[]; nextCursor: string | null; status: number; headers: Record<string, string>; returned: number };
export class SourceError extends Error { constructor(readonly status: number, readonly retryAfterMs: number, readonly code = 'HTTP_ERROR') { super(code); } }
export interface JobSourceAdapter {
  fetchPage(state: SourceState, signal: AbortSignal): Promise<JobPage>;
  normalize(raw: unknown): Job[];
  verifyActive(job: Job, signal: AbortSignal): Promise<'open' | 'closed' | 'unknown'>;
}
export class AtsAdapter implements JobSourceAdapter {
  private readonly observed = new Set<string>();
  constructor(readonly source: SourceConfig, private readonly transport: (url: string, options?: ReadOptions) => Promise<PublicResponse> = readPublic) { SourceConfigSchema.parse(source); }
  async fetchPage(state: SourceState, signal: AbortSignal): Promise<JobPage> {
    const url = new URL(sourceEndpoint(this.source));
    if (state.cursor !== null) { if (this.source.ats !== 'lever' || !/^\d{1,6}$/.test(state.cursor)) throw new SourceError(0, 0, 'INVALID_CURSOR'); url.searchParams.set('skip', state.cursor); }
    const headers: Record<string, string> = {};
    if (state.cursor === null && this.source.ats !== 'lever') { if (state.etag) headers['if-none-match'] = state.etag; if (state.lastModified) headers['if-modified-since'] = state.lastModified; }
    const response = await this.transport(url.href, { headers, signal });
    if (response.status === 304) return { jobs: [], nextCursor: null, returned: 0, status: 304, headers: response.headers };
    if (response.status !== 200) {
      const raw = response.headers['retry-after']; const numeric = Number(raw);
      const retry = raw ? Number.isFinite(numeric) ? Math.max(0, numeric * 1000) : Math.max(0, Date.parse(raw) - Date.now()) : 0;
      throw new SourceError(response.status, Number.isFinite(retry) ? retry : 0);
    }
    let payload: unknown; try { payload = JSON.parse(response.body.toString('utf8')); } catch { throw new SourceError(200, 0, 'SCHEMA_DRIFT'); }
    const jobs = this.normalize(payload);
    for (const job of jobs) this.observed.add(job.sourceJobId);
    const count = Array.isArray(payload) ? payload.length : z.object({ jobs: z.array(z.unknown()) }).parse(payload).jobs.length;
    const nextCursor = this.source.ats === 'lever' && count === 100 ? String(Number(state.cursor ?? 0) + 100) : null;
    return { jobs, nextCursor, returned: count, status: 200, headers: response.headers };
  }
  normalize(payload: unknown): Job[] {
    try {
      const records = this.source.ats === 'lever' ? z.array(z.unknown()).max(10000).parse(payload) : z.object({ jobs: z.array(z.unknown()).max(10000) }).parse(payload).jobs;
      return records.flatMap((raw): Job[] => {
        const s = this.source; let title: string; let url: string; let sourceId: string; let location: string; let description: string; let mode: string; let commitment = ''; let posted: string | null = null; let updated: string | null = null; let requisition: string | null = null; let salary: Job['salary'] = null;
        if (s.ats === 'greenhouse') {
          const r = gh.parse(raw); title = r.title; url = r.absolute_url; sourceId = String(r.id); location = r.location.name; description = plain(r.content); mode = /remote/i.test(location) ? 'remote' : 'unknown'; updated = r.updated_at ?? null; requisition = r.requisition_id ?? null;
        } else if (s.ats === 'lever') {
          const r = lever.parse(raw); title = r.text; url = r.hostedUrl; sourceId = String(r.id); location = r.categories?.location ?? ''; description = plain([r.descriptionPlain ?? r.description ?? '', ...(r.lists ?? []).map((l) => `${l.text}: ${l.content}`)].join(' ')); mode = r.workplaceType ?? (/remote/i.test(location) ? 'remote' : 'unknown'); commitment = r.categories?.commitment ?? ''; posted = r.createdAt ? new Date(r.createdAt).toISOString() : null;
          if (r.salaryRange) salary = { min: r.salaryRange.min ?? null, max: r.salaryRange.max ?? null, currency: r.salaryRange.currency, interval: r.salaryRange.interval, source: 'explicit' };
        } else {
          const r = ashby.parse(raw); if (r.isListed === false) return []; title = r.title; url = r.jobUrl; sourceId = String(r.id ?? sha256(canonicalUrl(r.jobUrl))); location = r.location ?? ''; description = r.descriptionPlain.slice(0, 100000); mode = r.isRemote ? 'remote' : r.workplaceType?.toLowerCase() ?? 'unknown'; commitment = r.employmentType ?? ''; posted = r.publishedAt ?? null;
          const salaryPart = r.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
          if (salaryPart?.currencyCode && salaryPart.interval) salary = { min: salaryPart.minValue ?? null, max: salaryPart.maxValue ?? null, currency: salaryPart.currencyCode, interval: salaryPart.interval, source: 'explicit' };
        }
        const canonical = canonicalUrl(url); const now = Date.now(); const hash = sha256(JSON.stringify(raw)); const key = `${s.ats}:${s.tenant}:${sourceId}`;
        return [JobSchema.parse({ id: key, source: s.ats, tenant: s.tenant, sourceJobId: sourceId, requisitionId: requisition, canonicalUrl: canonical, company: s.company, title: plain(title), location: plain(location), descriptionText: description, workMode: ['remote', 'hybrid', 'onsite'].includes(mode.toLowerCase()) ? mode.toLowerCase() : 'unknown', level: /intern/i.test(`${title} ${commitment}`) ? 'internship' : /new.?grad/i.test(title) ? 'new-grad' : /senior|\bsr\b|staff|principal/i.test(title) ? 'senior' : /junior|\bjr\b/i.test(title) ? 'junior' : 'unknown', postedAt: posted, updatedAt: updated, firstSeenAt: now, lastSeenAt: now, activeStatus: 'open', salary, contentSha256: sha256(description), rawSha256: hash, parserVersion: 'ats-v1', duplicateGroup: null, provenance: [{ sourceId: s.id, sourceKey: key, url, collectedAt: now, rawSha256: hash, fields: { title: s.ats === 'lever' ? 'text' : 'title', description: s.ats === 'greenhouse' ? 'content' : 'descriptionPlain', eligibility: 'explicit description excerpts only' } }] })];
      });
    } catch { throw new SourceError(200, 0, 'SCHEMA_DRIFT'); }
  }
  async verifyActive(job: Job, signal: AbortSignal): Promise<'open' | 'closed' | 'unknown'> {
    // Public listing evidence can prove open; absence from one snapshot cannot
    // safely prove closed. The discovery store applies the removal grace rule.
    return !signal.aborted && job.source === this.source.ats && job.tenant === this.source.tenant && this.observed.has(job.sourceJobId) ? 'open' : 'unknown';
  }
}
