/**
 * Finite verified employer seed directory and conservative career-page/feed inspection.
 * Recognizing a supported URL is separate from permission to collect it; restricted platforms remain excluded.
 */
import type { Employer, SourceConfig } from '@rovdo/shared';
const verifiedAt = '2026-10-18T00:00:00.000Z';
const refreshAfter = '2026-11-17T00:00:00.000Z';
// Read-only live validation on 2026-10-18. Finite starter coverage, not universal
// employer search. Policy review and expiry are separate from collection health.
export const EMPLOYERS: readonly Employer[] = [
  {
    id: 'figma',
    company: 'Figma',
    aliases: ['Figma Inc.'],
    ats: 'greenhouse',
    tenant: 'figma',
    reference: 'https://job-boards.greenhouse.io/figma',
    policyReference: 'https://docs.greenhouse.io/job-board',
    responseHash: 'dfd20445fb6a17bf67fb14e6cad325df0f97b3407df0ec43ce1867b89ee679ad',
  },
  {
    id: 'palantir',
    company: 'Palantir Technologies',
    aliases: ['Palantir'],
    ats: 'lever',
    tenant: 'palantir',
    reference: 'https://jobs.lever.co/palantir',
    policyReference: 'https://github.com/lever/postings-api',
    responseHash: '885628611d541b87e96c177b70201b98944bf98d929b5a8bbc7d661de41ef798',
  },
  {
    id: 'linear',
    company: 'Linear',
    aliases: ['Linear Orbit Inc.'],
    ats: 'ashby',
    tenant: 'linear',
    reference: 'https://jobs.ashbyhq.com/linear',
    policyReference: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    responseHash: '43551212d17938c950ff213d1910085f70b8daa6982712e1526bd03a1e768a3f',
  },
  {
    id: 'smartrecruiters',
    company: 'SmartRecruiters',
    aliases: [],
    ats: 'smartrecruiters',
    tenant: 'smartrecruiters',
    reference: 'https://careers.smartrecruiters.com/SmartRecruiters',
    policyReference: 'https://developers.smartrecruiters.com/docs/endpoints',
    responseHash: 'dd343c33c470fed1e87299640e449a7c124a75f563e0d8052bb781ea88e74b46',
  },
].map((e) => ({
  ...e,
  region: 'global',
  verifiedAt,
  refreshAfter,
  policy: 'approved',
})) as Employer[];
export function permittedPage(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.hostname.includes('.') &&
      !/^(\d|\[)/.test(u.hostname) &&
      !/(^|\.)(?:linkedin|indeed|glassdoor|facebook|x|twitter|ziprecruiter)\.[a-z.]+$/.test(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
}
export function feedFromUrl(value: string): Pick<SourceConfig, 'ats' | 'tenant' | 'region'> | null {
  if (!permittedPage(value)) return null;
  const u = new URL(value);
  if (u.search || u.hash) return null;
  const hosts: Record<string, SourceConfig['ats']> = {
    'boards.greenhouse.io': 'greenhouse',
    'job-boards.greenhouse.io': 'greenhouse',
    'jobs.lever.co': 'lever',
    'jobs.eu.lever.co': 'lever',
    'jobs.ashbyhq.com': 'ashby',
    'careers.smartrecruiters.com': 'smartrecruiters',
    'jobs.smartrecruiters.com': 'smartrecruiters',
  };
  const ats = hosts[u.hostname];
  const tenant = u.pathname.split('/')[1];
  return ats && tenant && /^[a-zA-Z0-9_-]{1,120}$/.test(tenant)
    ? { ats, tenant, region: u.hostname === 'jobs.eu.lever.co' ? 'eu' : 'global' }
    : null;
}
/**
 * RFC 9309: combine matching product-token groups; wildcard is fallback, never an override.
 * Compare percent-normalized octets, retaining encoded reserved characters and URL queries.
 */
export function robotsAllow(text: string, path: string): boolean {
  type Group = { agents: string[]; rules: { value: string; allow: boolean }[] };
  const groups: Group[] = [];
  let group: Group | undefined,
    rulesStarted = false;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(user-agent|allow|disallow)\s*:\s*([^#]*)/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase(),
      value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!group || rulesStarted) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      rulesStarted = false;
    } else if (group) {
      rulesStarted = true;
      if (value.startsWith('/')) group.rules.push({ value, allow: key === 'allow' });
    }
  }
  const exact = groups.filter((g) => g.agents.includes('rovdo'));
  const selected = exact.length ? exact : groups.filter((g) => g.agents.includes('*'));
  const normalize = (value: string) =>
    value.replace(/%[0-9a-f]{2}|[^\x21-\x7e]/giu, (part) => {
      if (!part.startsWith('%')) return encodeURIComponent(part);
      const decoded = String.fromCharCode(parseInt(part.slice(1), 16));
      return /^[a-zA-Z0-9._~-]$/.test(decoded) ? decoded : part.toUpperCase();
    });
  const target = normalize(path.split('#')[0]!);
  let best = -1,
    allowed = true;
  for (const rule of selected.flatMap((g) => g.rules)) {
    const anchored = rule.value.endsWith('$');
    const value = normalize(anchored ? rule.value.slice(0, -1) : rule.value);
    const pattern = value
      .split('*')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const length = Buffer.byteLength(value);
    if (
      new RegExp('^' + pattern + (anchored ? '$' : '')).test(target) &&
      (length > best || (length === best && rule.allow))
    ) {
      best = length;
      allowed = rule.allow;
    }
  }
  return allowed;
}
/** Inspect inert links/JSON-LD with bounded depth; never execute page scripts or follow arbitrary links. */
export function inspectCareerPage(
  html: string,
  page: string,
  company: string,
  complete = false,
): { feeds: Pick<SourceConfig, 'ats' | 'tenant' | 'region'>[]; postings: unknown[] } {
  if (!permittedPage(page) || html.length > 2_000_000) throw new Error('PAGE_BLOCKED');
  const feeds = new Map<string, Pick<SourceConfig, 'ats' | 'tenant' | 'region'>>();
  const postings: unknown[] = [];
  const direct = feedFromUrl(page);
  if (direct) feeds.set(`${direct.ats}:${direct.tenant}`, direct);
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const feed = feedFromUrl(new URL(m[1]!.replace(/&amp;/g, '&'), page).href);
      if (feed) feeds.set(`${feed.ats}:${feed.tenant}`, feed);
    } catch {
      /* malformed link */
    }
  }
  const visit = (raw: unknown, depth: number) => {
    if (depth > 5 || (!complete && postings.length >= 100)) return;
    if (Array.isArray(raw)) {
      raw.slice(0, complete ? raw.length : 100).forEach((x) => visit(x, depth + 1));
      return;
    }
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    if (
      r['@type'] === 'JobPosting' ||
      (Array.isArray(r['@type']) && r['@type'].includes('JobPosting'))
    ) {
      try {
        const url = new URL(typeof r.url === 'string' ? r.url : page, page);
        const employer = r.hiringOrganization as { name?: string } | undefined;
        if (
          url.origin === new URL(page).origin &&
          (!employer?.name ||
            (!company && complete) ||
            employer.name.toLowerCase() === company.toLowerCase())
        )
          postings.push({ ...r, url: url.href });
      } catch {
        /* off-origin or malformed */
      }
    }
    if (r['@graph']) visit(r['@graph'], depth + 1);
  };
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(m[1]!), 0);
    } catch {
      /* inert malformed JSON */
    }
  }
  return { feeds: complete ? [...feeds.values()] : [...feeds.values()].slice(0, 10), postings };
}
