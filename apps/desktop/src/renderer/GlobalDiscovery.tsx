/** Progressive global-search configuration, precise coverage and resumable collection controls. */
import { useState } from 'react';
import type { CareerCommand, DiscoveryOptions, DiscoveryViewSchema } from '@rovdo/shared';
import type { z } from 'zod';
type View = z.infer<typeof DiscoveryViewSchema>;
export const defaultDiscovery: DiscoveryOptions = {
  sourceIds: [
    'greenhouse',
    'lever',
    'ashby',
    'smartrecruiters',
    'remotive',
    'himalayas',
    'we-work-remotely',
    'simplify-new-grad-positions',
    'simplify-pitt-csc-summer-2027-internships',
    'vansh-new-grad-2027',
    'vansh-summer-2027-internships',
    'web-index',
  ],
  overrides: {},
};
export function GlobalDiscovery({
  view,
  options,
  onOptions,
  command,
  busy,
}: {
  view: View | undefined;
  options: DiscoveryOptions;
  onOptions: (v: DiscoveryOptions) => void;
  command: (c: CareerCommand) => Promise<void>;
  busy: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [sourceView, setSourceView] = useState<'all' | 'selected'>('all');
  const [showAll, setShowAll] = useState(false);
  const update = (next: DiscoveryOptions) => {
    onOptions(next);
  };
  const selected = (view?.registry ?? []).filter((s) => options.sourceIds.includes(s.id));
  return (
    <section className="global-discovery" aria-label="Global discovery">
      <p className="help-text">
        Search All uses verified technical qualifications to prioritize discovery across accessible
        feeds and public pages. It is not a claim to search every internet job. No AI provider is
        used.
      </p>
      <details className="surface-disclosure">
        <summary>Sources, queries and collection settings</summary>
        <label>
          Permitted SearXNG JSON endpoint (optional)
          <input
            type="url"
            placeholder="https://search.example/search"
            value={options.indexUrl ?? ''}
            onChange={(e) => {
              const next = { ...options };
              if (e.target.value) next.indexUrl = e.target.value;
              else delete next.indexUrl;
              update(next);
            }}
          />
        </label>
        <p className="help-text">
          Use an instance whose operator permits automated JSON search. No search-engine HTML
          scraping, CAPTCHA handling or authentication bypass. Without an index, public APIs and
          repository lists still discover employers beyond the saved directory.
        </p>
        <details>
          <summary>Exact qualification queries ({view?.plan.length ?? 0})</summary>
          <p>
            Only these technical terms and optional source filters are sent; profile contacts, legal
            facts and raw documents are excluded.
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
          {selected.length} selected / 126 catalog websites plus the open web index. Indexed and
          unsupported entries are not working direct scrapers.
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
                <p>{s.limitation}</p>
                <p className="job-url">{s.policyUrl}</p>
                {options.sourceIds.includes(s.id) && !['ats', 'remotive'].includes(s.adapter) && (
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
              </details>
            ))}
        </div>
      </details>
      {view?.run && (
        <section className="surface-card discovery-progress" aria-label="Discovery progress">
          <div className="button-row">
            <strong>
              {view.run.status === 'running'
                ? 'Collection in progress'
                : `Collection ${view.run.status}`}
            </strong>
            {view.run.status === 'running' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command({ op: 'controlDiscovery', id: view.run!.id, action: 'pause' })
                  }
                >
                  Pause discovery
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command({ op: 'controlDiscovery', id: view.run!.id, action: 'cancel' })
                  }
                >
                  Cancel discovery
                </button>
              </>
            )}
            {view.run.status === 'paused' && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void command({ op: 'controlDiscovery', id: view.run!.id, action: 'resume' })
                }
              >
                Resume discovery
              </button>
            )}
          </div>
          <p aria-live="polite">
            {view.companies} discovered companies /{' '}
            {
              view.coverage.filter((s) => s.requests > 0 || s.records > 0 || s.status === 'ready')
                .length
            }{' '}
            sources searched / {view.jobs} unique jobs collected / {view.filtered} filtered /{' '}
            {view.pending} pending pages or resolutions
          </p>
          <p className="help-text">
            {view.done} completed tasks. Progress and cached results survive restarts. Cached feeds,
            unavailable sources and unverified leads are not live availability guarantees.
          </p>
          {view.run.reason && <p>{view.run.reason}</p>}
          <details>
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
                      <td>{s.status}</td>
                      <td>{s.requests}</td>
                      <td>{s.records}</td>
                      <td>{s.rejected}</td>
                      <td>{s.error ?? 'None'}</td>
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
