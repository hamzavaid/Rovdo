/** Task-first job results, adapted from the supplied prototype using actual persisted matches and IPC actions. */
import type { ReactNode, MouseEvent } from 'react';
import { eligibilityOutcome } from '@rovdo/career';
import type { CareerCommand, CareerViewSchema, JobMatch, RankingProfile } from '@rovdo/shared';
import type { z } from 'zod';
type View = z.infer<typeof CareerViewSchema>;
export function JobCard({
  match: m,
  saved,
  marker,
  rankings,
  reviews,
  compareId,
  command,
  onReview,
  busy,
}: {
  match: JobMatch;
  saved: boolean;
  marker: View['markers'][number] | undefined;
  rankings: readonly RankingProfile[];
  reviews: View['reviews'];
  compareId: string;
  command: (c: CareerCommand) => Promise<void>;
  onReview: () => void;
  busy: boolean;
}) {
  const url = m.job.canonicalUrl;
  const eligibility = eligibilityOutcome(m);
  const link = (children: ReactNode, className?: string) => (
    <a
      className={className}
      href={url}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        void command({ op: 'openJob', jobId: m.job.id });
      }}
    >
      {children}
    </a>
  );
  const legacy = m.ranking?.method === 'legacy-v1' || !m.ranking;
  const method =
    rankings.find((p) => p.id === m.ranking?.configId)?.name ??
    (legacy
      ? 'Legacy v1'
      : m.ranking?.method === 'technical-v2'
        ? 'Technical qualification'
        : 'Opportunity fit');
  const salary = m.job.salary;
  const amount = (n: number | null) =>
    n === null
      ? 'Unknown'
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
  const period = salary?.interval
    .replace(/^(per-|per_)/, '')
    .replace(/-salary$/, '')
    .replace(/yearly|annual/, 'year')
    .replace(/hourly/, 'hour');
  return (
    <article className="job-card job-card-v2">
      <header className="job-headline">
        <div>
          <div className="job-employer">
            <span className="company-mark" aria-hidden="true">
              {m.job.company
                .split(/\s+/)
                .slice(0, 2)
                .map((s) => s[0])
                .join('')
                .toUpperCase()}
            </span>
            <strong>{m.job.company}</strong>
            {(marker?.seenAt ?? 0) < m.job.firstSeenAt && (
              <span className="new-badge">New posting</span>
            )}
          </div>
          <h2>{link(m.job.title, 'job-title-link')}</h2>
          <div className="job-meta">
            <span>{m.job.location || 'Location unknown'}</span>
            <span>{m.job.workMode}</span>
            {salary && (
              <span>
                {salary.currency} {amount(salary.min)} - {amount(salary.max)} / {period}
              </span>
            )}
            <span>
              {m.job.postedAt
                ? `Posted ${new Date(m.job.postedAt).toLocaleDateString()}`
                : 'Posting date unknown'}
            </span>
          </div>
        </div>
        <aside className="job-score" aria-label={`${method} score`}>
          <small>Match score</small>
          <strong>
            {m.score.toFixed(1)} <span>/ 100</span>
          </strong>
          <meter min={0} max={100} value={m.score} aria-label="Match score out of 100" />
          <small>{method}</small>
        </aside>
      </header>
      <section className="job-fit-snapshot" aria-label="Job fit snapshot">
        <div>
          <small>Eligibility</small>
          <strong
            className={`fit-badge ${eligibility === 'FAIL' ? 'failed' : eligibility === 'UNKNOWN' ? 'review' : 'passed'}`}
          >
            {eligibility === 'FAIL'
              ? 'Excluded by hard requirement'
              : eligibility === 'UNKNOWN'
                ? 'Eligibility needs review'
                : 'Published checks passed'}
          </strong>
        </div>
        <div>
          <small>Evidence confidence</small>
          <strong>{Math.round(m.confidence * 100)}%</strong>
          <span>{m.matchedSkills.length} verified skill matches</span>
          {m.review && eligibility === 'PASS' && <span>Qualification evidence needs review</span>}
        </div>
        <div>
          <small>Required-skill coverage</small>
          <strong>
            {legacy
              ? 'Not assessed by Legacy v1'
              : `${Math.round((m.ranking?.requiredCoverage ?? 0) * 100)}%`}
          </strong>
          <span>
            {m.ranking?.preferenceScore === null || m.ranking?.preferenceScore === undefined
              ? 'Preference fit unknown'
              : `Preference fit ${m.ranking.preferenceScore}%`}
          </span>
        </div>
      </section>
      <div className="job-card-actions">
        <button
          className="primary-button"
          disabled={busy}
          aria-pressed={saved}
          onClick={() => void command({ op: 'saveJob', jobId: m.job.id, saved: !saved })}
        >
          {saved ? 'Remove saved opportunity' : 'Save opportunity'}
        </button>
        {link('View posting', 'button-link')}
        <button
          aria-pressed={marker?.feedback === 'relevant'}
          onClick={() =>
            void command({
              op: 'markJob',
              jobId: m.job.id,
              feedback: marker?.feedback === 'relevant' ? 'none' : 'relevant',
            })
          }
        >
          Relevant
        </button>
        <details className="job-more">
          <summary aria-label="More job actions">More actions</summary>
          <div className="job-action-menu">
            <button
              onClick={() =>
                void command({ op: 'markJob', jobId: m.job.id, applied: !marker?.applied })
              }
            >
              {marker?.applied ? 'Clear applied marker' : 'Mark as applied'}
            </button>
            <button
              aria-pressed={marker?.feedback === 'irrelevant'}
              onClick={() =>
                void command({ op: 'markJob', jobId: m.job.id, feedback: 'irrelevant' })
              }
            >
              Irrelevant
            </button>
            <button
              onClick={() => void command({ op: 'markJob', jobId: m.job.id, feedback: 'none' })}
            >
              Clear feedback
            </button>
            <button onClick={() => void command({ op: 'markJob', jobId: m.job.id, seen: true })}>
              Mark as read
            </button>
            <button
              onClick={() =>
                void command({
                  op: 'compare',
                  jobId: m.job.id,
                  rankingIds: [
                    ...new Set([
                      m.ranking?.configId ?? 'builtin:technical-balanced',
                      compareId,
                      m.ranking?.configId === 'builtin:technical-balanced'
                        ? 'builtin:legacy-v1'
                        : 'builtin:technical-balanced',
                    ]),
                  ].slice(0, 2),
                })
              }
            >
              Compare ranking methods
            </button>
            {saved && !m.excluded && <button onClick={onReview}>Preview optional AI review</button>}
          </div>
        </details>
      </div>
      <div className="job-card-explanation">
        <p className="job-credit">
          Source: {link(m.job.discovery?.sourceName ?? m.job.source)}{' '}
          <span className="verification-badge">
            {m.job.discovery?.availability ??
              (m.job.activeStatus === 'open' ? 'verified' : 'unverified')}{' '}
            posting
          </span>
          {marker?.applied && <span className="verification-badge">Applied</span>}
        </p>
        <details>
          <summary>Eligibility, ranking and provenance</summary>
          <p>Matched skills: {m.matchedSkills.join(', ') || 'None verified'}</p>
          <p>Qualification gaps: {m.gaps.join(', ') || 'No explicit gaps extracted'}</p>
          {m.ranking && (
            <>
              <p>
                Configuration {m.ranking.configId} revision {m.ranking.configRevision} / taxonomy{' '}
                {m.ranking.taxonomyVersion}
                {' / requirements '}
                {m.ranking.parserVersion} / evidence {m.ranking.evidenceVersion}
                {' / as of '}
                {m.ranking.asOf}
              </p>
              <table className="ranking-breakdown">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Match</th>
                    <th>Active weight</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {m.ranking.components.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{c.value === null ? 'Inactive' : `${Math.round(c.value * 100)}%`}</td>
                      <td>{(c.activeWeight * 100).toFixed(1)}%</td>
                      <td>{c.contribution.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.ranking.requirements.map((r) => (
                <p key={r.id}>
                  {r.importance}: {r.excerpt} / {Math.round(r.strength * 100)}
                  {'% / '}
                  {r.explanation} / evidence {r.evidenceIds.join(', ') || 'missing'}
                </p>
              ))}
            </>
          )}
          <ul>
            {m.checks.map((c, i) => (
              <li key={i}>
                {c.result} · {c.rule}: {c.excerpt}
              </li>
            ))}
          </ul>
          <p>
            Profile v{m.profileVersion} · {m.scorerVersion}
            {' · BM25 '}
            {m.bm25Raw.toFixed(6)} (lower is more relevant)
          </p>
          {m.reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          <p>
            {m.job.duplicateGroup
              ? 'Possible duplicate or employer conflict: review required.'
              : 'No duplicate conflict detected.'}
          </p>
          <ul>
            {m.job.provenance.map((p) => (
              <li key={p.sourceKey}>
                {p.sourceKey} · {p.url}
                {' · collected '}
                {new Date(p.collectedAt).toLocaleString()}
                {' · raw hash '}
                {p.rawSha256.slice(0, 16)}
              </li>
            ))}
          </ul>
        </details>

        {reviews
          .filter((r) => r.jobId === m.job.id)
          .map((r) => (
            <details key={`${r.model}-${r.createdAt}`}>
              <summary>Advisory AI review / {r.model}</summary>
              <p>{r.text}</p>
              <p>
                Estimated ${r.estimatedUsd?.toFixed(6) ?? 'unavailable'}. Deterministic evidence
                remains authoritative.
              </p>
            </details>
          ))}
      </div>
    </article>
  );
}
