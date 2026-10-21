/**
 * Secondary job filters, saved-search controls and advanced employer/source management.
 * These controls update the existing career command/search contracts rather than fetching feeds directly.
 */
import { useState } from 'react';
import type { CareerCommand, JobSearch, CareerViewSchema } from '@rovdo/shared';
import type { z } from 'zod';
type View = z.infer<typeof CareerViewSchema>;
export function AdvancedFilters({
  search,
  setSearch,
}: {
  search: JobSearch;
  setSearch: (s: JobSearch) => void;
}) {
  const set = (key: keyof JobSearch, value: unknown) => setSearch({ ...search, [key]: value });
  const numeric = (key: keyof JobSearch, label: string, min: number, max: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={String(search[key] ?? '')}
        onChange={(e) => {
          const next = { ...search };
          if (e.target.value) Object.assign(next, { [key]: Number(e.target.value) });
          else delete next[key];
          setSearch(next);
        }}
      />
    </label>
  );
  return (
    <details className="advanced-filters">
      <summary>Advanced search filters</summary>
      <p>
        These filters narrow results without changing candidate evidence or the saved ranking
        method. Unknown eligibility remains reviewable.
      </p>
      <div className="career-fields">
        <label>
          Company name
          <input value={search.company} onChange={(e) => set('company', e.target.value)} />
        </label>
        <label>
          Employment type
          <select
            value={search.employmentType ?? 'all'}
            onChange={(e) => set('employmentType', e.target.value)}
          >
            {[
              'all',
              'full-time',
              'part-time',
              'contract',
              'internship',
              'temporary',
              'unknown',
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Posting verification
          <select
            value={search.availability ?? 'all'}
            onChange={(e) => set('availability', e.target.value)}
          >
            {['all', 'verified', 'unverified'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Technical role family
          <select
            value={search.roleFamily ?? 'all'}
            onChange={(e) => set('roleFamily', e.target.value)}
          >
            {[
              'all',
              'software',
              'platform',
              'data-science',
              'security',
              'analytics',
              'unknown',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Internship season
          <select value={search.season ?? 'all'} onChange={(e) => set('season', e.target.value)}>
            {['all', 'spring', 'summer', 'fall', 'winter'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        {numeric('graduationYear', 'Graduation eligibility year', 2000, 2100)}
        <label>
          Experience level
          <select
            value={search.experienceLevel ?? 'all'}
            onChange={(e) => set('experienceLevel', e.target.value)}
          >
            {['all', 'internship', 'new-grad', 'junior', 'mid', 'senior', 'unknown'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Location or remote jurisdiction
          <input value={search.location ?? ''} onChange={(e) => set('location', e.target.value)} />
        </label>
        {numeric('minimumSalary', 'Minimum published annual salary', 0, 10000000)}
        <label>
          Salary filter currency
          <input
            value={search.salaryCurrency ?? 'USD'}
            maxLength={3}
            onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())}
          />
        </label>
        {numeric('freshnessDays', 'Posted within days', 1, 3650)}
        {numeric('minimumScore', 'Minimum qualification score', 0, 100)}
        <label>
          Eligibility constraint
          <select
            value={search.eligibility ?? 'all'}
            onChange={(e) => set('eligibility', e.target.value)}
          >
            <option value="all">All eligibility outcomes</option>
            <option value="pass">Published checks passed</option>
            <option value="review">Needs review</option>
            <option value="fail">Explicit failure (enable Show excluded)</option>
          </select>
        </label>
        <label>
          My relevance feedback
          <select
            value={search.feedback ?? 'all'}
            onChange={(e) => set('feedback', e.target.value)}
          >
            {['all', 'relevant', 'irrelevant'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={search.hideApplied ?? false}
            onChange={(e) => set('hideApplied', e.target.checked)}
          />
          Hide applied jobs
        </label>
        <label>
          <input
            type="checkbox"
            checked={search.newOnly ?? false}
            onChange={(e) => set('newOnly', e.target.checked)}
          />
          New postings only
        </label>
      </div>
    </details>
  );
}
export function DiscoveryControls({
  view,
  search,
  loadSearch,
  command,
  busy,
  mode = 'all',
}: {
  mode?: 'saved' | 'sources' | 'all';
  view: View | null;
  search: JobSearch;
  loadSearch: (s: JobSearch) => void;
  command: (c: CareerCommand) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [policy, setPolicy] = useState('');
  const [permitted, setPermitted] = useState(false);
  return (
    <section
      className="discovery-controls"
      aria-label={
        mode === 'saved'
          ? 'Saved search management'
          : mode === 'sources'
            ? 'Employer source directory'
            : 'Discovery coverage and saved searches'
      }
    >
      {mode !== 'sources' && (
        <details className="saved-searches">
          <summary>Saved searches</summary>
          <div className="saved-search-editor">
            <label>
              Saved search name
              <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              disabled={!name.trim() || busy}
              onClick={() => void command({ op: 'saveSearch', name: name.trim(), search })}
            >
              Save current search
            </button>
          </div>
          {view?.savedSearches.map((s) => (
            <div className="button-row" key={s.id}>
              <button onClick={() => loadSearch(s.search)}>Load {s.name}</button>
              <button onClick={() => void command({ op: 'deleteSearch', id: s.id })}>
                Delete {s.name}
              </button>
            </div>
          ))}
        </details>
      )}
      {mode !== 'saved' && (
        <>
          <details>
            <summary>Verified source directory</summary>
            <p>
              Feed verification freshness is separate from policy permission and collection health.
              Approved stale feeds are revalidated on Search All Saved Companies. Opting out stays
              in effect on subsequent searches.
            </p>
            {view?.directory.map((e) => {
              const source = view.sources.find(
                (s) =>
                  s.config.directoryId === e.id ||
                  (s.config.ats === e.ats &&
                    s.config.tenant === e.tenant &&
                    s.config.region === e.region),
              );
              return (
                <article className="directory-entry" key={e.id}>
                  <div className="directory-heading">
                    <h3>{e.company}</h3>
                    <button
                      disabled={busy || e.policy !== 'approved'}
                      onClick={() =>
                        void command({
                          op: 'saveSource',
                          source: source
                            ? { ...source.config, enabled: !source.config.enabled }
                            : {
                                id: crypto.randomUUID(),
                                ats: e.ats,
                                tenant: e.tenant,
                                company: e.company,
                                enabled: true,
                                region: e.region,
                                intervalMs: 86400000,
                                termsReviewedAt: e.verifiedAt,
                                timezone: 'UTC',
                                priority: 0,
                                missingGracePolls: 3,
                                directoryId: e.id,
                                companyId: e.id,
                                ...(e.pageUrl ? { pageUrl: e.pageUrl } : {}),
                              },
                        })
                      }
                    >
                      {source?.config.enabled ? `Disable ${e.company}` : `Enable ${e.company}`}
                    </button>
                  </div>
                  <p>
                    {e.ats} · {e.policy} · verified {new Date(e.verifiedAt).toLocaleDateString()} ·
                    review by {new Date(e.refreshAfter).toLocaleDateString()}
                    {' · '}
                    {source?.state.status ?? 'Not enabled'}
                  </p>
                  <p className="job-url">{e.reference}</p>
                  <small className="directory-provenance">
                    Policy reference: {e.policyReference}
                    {' · response hash '}
                    {e.responseHash.slice(0, 16)}
                  </small>
                </article>
              );
            })}
          </details>
          <details>
            <summary>Discover another permitted employer source</summary>
            <p>
              Provide a public employer careers URL or supported board URL. Rovdo checks robots
              restrictions, reads one page and validates up to three supported feeds or same-origin
              JobPosting data. No login, restricted platform or recursive crawl.
            </p>
            <div className="career-fields">
              <label>
                Employer careers URL
                <input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setPermitted(false);
                  }}
                />
              </label>
              <label>
                Employer identity
                <input value={company} onChange={(e) => setCompany(e.target.value)} />
              </label>
              <label>
                Reviewed access policy URL
                <input
                  value={policy}
                  onChange={(e) => {
                    setPolicy(e.target.value);
                    setPermitted(false);
                  }}
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={permitted}
                onChange={(e) => setPermitted(e.target.checked)}
              />
              I reviewed this employer's policy and confirm read-only collection is permitted
            </label>
            <button
              disabled={busy || !url || !company || !policy || !permitted}
              onClick={() =>
                void command({
                  op: 'discoverFeeds',
                  url,
                  company,
                  policyUrl: policy,
                  permitted: true,
                })
              }
            >
              Verify employer source
            </button>
          </details>
        </>
      )}
    </section>
  );
}
