/** Progressive global-search configuration, precise coverage and resumable collection controls. */
import { useState } from 'react';
import { JOB_SOURCE_IDS } from '@rovdo/shared';
import { discoveryOptionsForSearch } from './discovery-search';
import type {
  CareerCommand,
  DiscoveryOptions,
  DiscoveryViewSchema,
  JobSearch,
} from '@rovdo/shared';
import type { z } from 'zod';
type View = z.infer<typeof DiscoveryViewSchema>;
const archiveSources = new Set(['wayback', 'common-crawl']);
const atsSources = new Set(['greenhouse', 'lever', 'ashby', 'smartrecruiters']);
function sourceReason(code: string | null): string {
  if (!code) return 'None';
  if (/^HTTP_5\d\d$/.test(code))
    return `Source temporarily unavailable (${code.replace('HTTP_', 'HTTP ')}). Other sources continue.`;
  return (
    (
      {
        REQUEST_TIMEOUT: 'Source did not respond before the request deadline.',
        DNS_LOOKUP_FAILED:
          'Could not resolve the source address. Check your connection or try later.',
        CONNECTION_FAILED: 'Could not connect to the source. Try again later.',
        NO_EMPLOYERS_DISCOVERED:
          'No company boards were found for this ATS. Enable public job lists or feeds to discover employers.',
        SOURCE_RESPONSE_ERROR: 'Source request failed. Other sources continue; try again later.',
        ARCHIVE_INDEX_UNAVAILABLE:
          'The Common Crawl query service was unavailable. Continuing through public index files or older published collections; coverage is partial.',
        ARCHIVE_HOST_UNAVAILABLE:
          'A Wayback query or index page was unavailable. Continuing with bounded pages or other ATS hosts; coverage is partial.',
        HTTP_429: 'Source rate limit reached. Waiting for its retry window.',
      } as Record<string, string>
    )[code] ?? code
  );
}
export const defaultDiscovery: DiscoveryOptions = {
  sourceIds: [...JOB_SOURCE_IDS],
  overrides: {},
};
export function GlobalDiscovery({
  view,
  criteria,
  options,
  onOptions,
  command,
  busy,
}: {
  view: View | undefined;
  criteria?: JobSearch;
  options: DiscoveryOptions;
  onOptions: (v: DiscoveryOptions) => void;
  command: (c: CareerCommand) => Promise<void>;
  busy: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [sourceView, setSourceView] = useState<'all' | 'selected'>('all');
  const [showAll, setShowAll] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const update = (next: DiscoveryOptions) => {
    onOptions(next);
  };
  const selected = (view?.registry ?? []).filter((s) => options.sourceIds.includes(s.id));
  const activeIds =
    view?.run?.status === 'running' ? view.run.options.sourceIds : options.sourceIds;
  const archiveOnly =
    activeIds.some((id) => archiveSources.has(id)) &&
    activeIds.every((id) => archiveSources.has(id) || atsSources.has(id));
  const unavailable = view?.coverage.some((s) => ['blocked', 'retrying'].includes(s.status));
  const useRecommended = async () => {
    setRestarting(true);
    try {
      const next = { ...options, sourceIds: defaultDiscovery.sourceIds };
      update(next);
      if (view?.run?.status === 'running')
        await command({ op: 'controlDiscovery', id: view.run.id, action: 'cancel' });
      await command({
        op: 'startDiscovery',
        options: criteria
          ? discoveryOptionsForSearch({ ...criteria, discovery: next }, next)
          : next,
        consent: true,
      });
    } finally {
      setRestarting(false);
    }
  };
  return (
    <section className="global-discovery" aria-label="Global discovery">
      <p className="help-text">
        Search All uses verified technical qualifications to prioritize discovery across accessible
        feeds and public pages. It is not a claim to search every internet job. No AI provider is
        used.
      </p>
      {(archiveOnly || unavailable) && (
        <div className="surface-card" role="status">
          <strong>
            {archiveOnly ? 'Archive-only discovery' : 'Some discovery sources are unavailable'}
          </strong>
          <p className="help-text">
            {archiveOnly
              ? 'These ATS adapters need discovered company boards. Archive indexes can be slow or unavailable; public job lists and feeds provide independent discovery. Previously successful enabled employers are searched immediately.'
              : 'Healthy sources continue independently. Failed archive requests are retried once after a cooldown, then marked unavailable for this search. Cached jobs and saved opportunities are preserved.'}
          </p>
          {archiveOnly && (
            <button
              type="button"
              disabled={busy || restarting}
              onClick={() => void useRecommended()}
            >
              {restarting ? 'Restarting discovery…' : 'Search with recommended sources'}
            </button>
          )}
        </div>
      )}
      <details className="surface-disclosure" open>
        <summary>Sources, queries and collection settings</summary>
        <details>
          <summary>Profile-guided queries ({view?.plan.length ?? 0})</summary>
          <p>
            Your search keywords and filters also apply. Only technical search terms are sent;
            profile contacts, legal facts and raw documents are excluded.
          </p>
          <ul className="query-preview">
            {view?.plan.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </details>
        <div className="button-row">
          <button type="button" onClick={() => update({ ...options, sourceIds: [] })}>
            Clear source selection
          </button>
          <button
            type="button"
            onClick={() => update({ ...options, sourceIds: defaultDiscovery.sourceIds })}
          >
            Restore default sources
          </button>
        </div>
        <label>
          Find discovery sources
          <input value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <p>
          {selected.length} selected / {view?.registry.length ?? 0} supported sources. Archive
          indexes discover board identities; live employer feeds verify jobs.
        </p>
        <div className="source-list-tools">
          <button
            type="button"
            aria-pressed={sourceView === 'all'}
            onClick={() => setSourceView('all')}
          >
            All sources
          </button>
          <button
            type="button"
            aria-pressed={sourceView === 'selected'}
            onClick={() => setSourceView('selected')}
          >
            Selected sources ({selected.length})
          </button>
          <button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Use compact list' : 'Show full source list'}
          </button>
        </div>
        <div className={`discovery-source-list ${showAll ? 'expanded' : ''}`}>
          {view?.registry
            .filter(
              (s) =>
                (sourceView === 'all' || options.sourceIds.includes(s.id)) &&
                (s.name + ' ' + s.mode).toLowerCase().includes(filter.toLowerCase()),
            )
            .map((s) => (
              <details key={s.id} className="discovery-source">
                <summary>
                  <label onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={options.sourceIds.includes(s.id)}
                      disabled={s.status === 'blocked' || s.status === 'unsupported'}
                      onChange={(e) =>
                        update({
                          ...options,
                          sourceIds: e.target.checked
                            ? [...new Set([...options.sourceIds, s.id])]
                            : options.sourceIds.filter((id) => id !== s.id),
                        })
                      }
                    />
                    {s.name}
                  </label>
                  <small>
                    {s.mode} / {s.status}
                  </small>
                </summary>
                <div className="discovery-source-body">
                  <p className="help-text">{s.limitation}</p>
                  <p className="job-url source-policy">Policy: {s.policyUrl}</p>
                  {options.sourceIds.includes(s.id) &&
                    !['ats', 'remotive', 'wayback', 'common-crawl'].includes(s.adapter) && (
                      <div className="career-fields">
                        <label>
                          {s.name} query / priority keywords
                          <input
                            value={options.overrides[s.id]?.keywords ?? ''}
                            onChange={(e) =>
                              update({
                                ...options,
                                overrides: {
                                  ...options.overrides,
                                  [s.id]: { ...options.overrides[s.id], keywords: e.target.value },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {s.name} query / priority location
                          <input
                            value={options.overrides[s.id]?.location ?? ''}
                            onChange={(e) =>
                              update({
                                ...options,
                                overrides: {
                                  ...options.overrides,
                                  [s.id]: { ...options.overrides[s.id], location: e.target.value },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                    )}
                </div>
              </details>
            ))}
        </div>
      </details>
      {view?.run && (
        <section className="surface-card discovery-progress" aria-label="Collection health details">
          <details open>
            <summary>Collection health ({view.coverage.length})</summary>
            <div className="coverage-table">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Requests</th>
                    <th>Records</th>
                    <th>Rejected</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {view.coverage.map((s) => (
                    <tr key={s.sourceId}>
                      <td>{view.registry.find((r) => r.id === s.sourceId)?.name ?? s.sourceId}</td>
                      <td>{s.status.replaceAll('-', ' ')}</td>
                      <td>{s.requests}</td>
                      <td>{s.records}</td>
                      <td>{s.rejected}</td>
                      <td>{sourceReason(s.error)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
      {!!view?.runs.some((r) => r.status === 'paused') && (
        <details>
          <summary>Paused searches</summary>
          {view.runs
            .filter((r) => r.status === 'paused')
            .map((r) => (
              <div className="button-row" key={r.id}>
                <span>
                  {new Date(r.createdAt).toLocaleString()} / {r.options.sourceIds.length} sources /
                  profile {r.profileVersion ?? 'none'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command({ op: 'controlDiscovery', id: r.id, action: 'resume' })
                  }
                >
                  Resume search {r.id.slice(0, 8)}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command({ op: 'controlDiscovery', id: r.id, action: 'cancel' })
                  }
                >
                  Cancel search {r.id.slice(0, 8)}
                </button>
              </div>
            ))}
        </details>
      )}
      {!!view?.listingCount && (
        <details>
          <summary>Unverified discoveries awaiting resolution ({view.listingCount})</summary>
          <p>
            These leads lack a complete or verified public posting and do not receive invented
            qualification scores. Showing the latest 20 unresolved leads.
          </p>
          <div className="qualification-rows">
            {view.listings.map((l) => (
              <div className="qualification-row" key={l.id}>
                <span>
                  <strong>{l.title}</strong>
                  <small>
                    {l.company ?? 'Employer unverified'} / {l.status} /{' '}
                    {l.reason ?? 'Waiting for public source evidence'}
                  </small>
                  <small className="job-url">{l.url}</small>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
