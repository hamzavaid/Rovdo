/** Export stored public job data only; source redistribution restrictions and CSV formula safety apply. */
import type { JobMatch } from '@rovdo/shared';
export function exportJobs(
  matches: JobMatch[],
  format: 'csv' | 'json',
): { data: string; skipped: number } {
  const allowed = matches.filter(
    (m) =>
      m.job.discovery?.exportAllowed !== false &&
      !m.job.provenance.some((p) => p.fields.exportAllowed === 'false'),
  );
  const rows = allowed.map((m) => ({
    company: m.job.company,
    title: m.job.title,
    location: m.job.location,
    workMode: m.job.workMode,
    salary: m.job.salary ? JSON.stringify(m.job.salary) : '',
    postedAt: m.job.postedAt ?? '',
    source: m.job.discovery?.sourceName ?? m.job.source,
    availability:
      m.job.discovery?.availability ?? (m.job.activeStatus === 'open' ? 'verified' : 'unverified'),
    applicationUrl: m.job.discovery?.attributionUrl ?? m.job.canonicalUrl,
    qualificationScore: m.score,
    confidence: m.confidence,
    eligibility: m.excluded ? 'FAIL' : m.review ? 'UNKNOWN' : 'PASS',
    requiredCoverage: m.ranking?.requiredCoverage ?? null,
    ranking: m.ranking?.configId ?? m.scorerVersion,
  }));
  if (format === 'json')
    return { data: JSON.stringify(rows, null, 2), skipped: matches.length - allowed.length };
  const columns = [
    'company',
    'title',
    'location',
    'workMode',
    'salary',
    'postedAt',
    'source',
    'availability',
    'applicationUrl',
    'qualificationScore',
    'confidence',
    'eligibility',
    'requiredCoverage',
    'ranking',
  ] as const;
  const escape = (value: unknown) => {
    let cell = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  };
  return {
    data: [columns.join(','), ...rows.map((r) => columns.map((c) => escape(r[c])).join(','))].join(
      '\r\n',
    ),
    skipped: matches.length - allowed.length,
  };
}
