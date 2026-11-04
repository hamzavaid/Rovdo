import { useState } from 'react';
import type { CareerCommand, CareerViewSchema, DiscoveryOptions, JobSearch } from '@rovdo/shared';
import type { z } from 'zod';
import { ProfileDialog } from './ProfileDialog';
import { HealthTable, RequestLog } from './JobsCollection';
export function JobsScope({
  view,
  search,
  onChange,
  command,
  busy,
}: {
  view: z.infer<typeof CareerViewSchema> | null;
  search: JobSearch;
  onChange: (s: JobSearch) => void;
  command: (c: CareerCommand) => Promise<void>;
  busy: boolean;
}) {
  const [picker, setPicker] = useState(false),
    [term, setTerm] = useState(''),
    [dialog, setDialog] = useState<'queries' | 'help' | 'log' | null>(null),
    [queries, setQueries] = useState('');
  const options = search.discovery!;
  const update = (discovery: DiscoveryOptions) => onChange({ ...search, discovery });
  const registry = view?.discovery?.registry ?? [];
  const issues = view?.discovery?.coverage.filter((c) => c.error).length ?? 0;
  return (
    <section className="jobs-page">
      <div className="jobs-row">
        <div>
          <h1>Scope &amp; Collection</h1>
          <p>Choose future collection sources. These controls do not filter cached results.</p>
        </div>
        <button
          onClick={() => {
            setQueries(view?.discovery?.plan.join('\n') ?? '');
            setDialog('queries');
          }}
        >
          Profile-guided queries
        </button>
      </div>
      <section className="surface-card">
        <h2>Search scope</h2>
        <label>
          Search scope
          <select
            aria-label="Search scope"
            value={search.scope ?? 'global'}
            onChange={(e) =>
              onChange({ ...search, scope: e.target.value as JobSearch['scope'], offset: 0 })
            }
          >
            <option value="global">Search All</option>
            <option value="saved-companies">Search All Saved Companies</option>
            <option value="company">Selected Company</option>
          </select>
        </label>
        {search.scope === 'company' && (
          <label>
            Selected company
            <select
              value={search.selectedSourceId ?? ''}
              onChange={(e) => onChange({ ...search, selectedSourceId: e.target.value, offset: 0 })}
            >
              <option value="">Choose a configured employer</option>
              {view?.sources.map((s) => (
                <option key={s.config.id} value={s.config.id}>
                  {s.config.company}
                </option>
              ))}
            </select>
          </label>
        )}
        <h2>Job sources</h2>
        <p className="help-text">
          Eleven collection adapters, without a limit on companies. Historical archive finders are
          managed separately under Companies.
        </p>
        <div className="jobs-chips">
          {registry
            .filter((s) => options.sourceIds.includes(s.id))
            .map((s) => (
              <button
                key={s.id}
                aria-label={`Remove source ${s.name}`}
                onClick={() =>
                  update({ ...options, sourceIds: options.sourceIds.filter((id) => id !== s.id) })
                }
              >
                {s.name} ×
              </button>
            ))}
          <button aria-expanded={picker} onClick={() => setPicker(!picker)}>
            + Select sources
          </button>
        </div>
        {picker && (
          <div className="source-picker">
            <label>
              Find discovery sources
              <input value={term} onChange={(e) => setTerm(e.target.value)} />
            </label>
            {registry
              .filter((s) => s.name.toLowerCase().includes(term.toLowerCase()))
              .map((s) => (
                <label className="discovery-source" key={s.id}>
                  <input
                    aria-label={s.name}
                    type="checkbox"
                    checked={options.sourceIds.includes(s.id)}
                    onChange={(e) =>
                      update({
                        ...options,
                        sourceIds: e.target.checked
                          ? [...options.sourceIds, s.id]
                          : options.sourceIds.filter((id) => id !== s.id),
                      })
                    }
                  />
                  <span>{s.name}</span>
                  <small>{s.mode}</small>
                </label>
              ))}
          </div>
        )}
        <div className="jobs-row">
          <span className="help-text">{options.sourceIds.length} selected sources</span>
          <div className="button-row">
            <button onClick={() => update({ ...options, sourceIds: registry.map((s) => s.id) })}>
              Select all
            </button>
            <button onClick={() => update({ ...options, sourceIds: [] })}>Clear selection</button>
          </div>
        </div>
        <details>
          <summary>Per-source collection preferences</summary>
          <p className="help-text">
            Prioritize retrieval, separately from qualification scoring and cached-result filters.
          </p>
          {registry
            .filter((s) => options.sourceIds.includes(s.id))
            .map((s) => (
              <details key={s.id}>
                <summary>{s.name}</summary>
                {(['keywords', 'location'] as const).map((key) => (
                  <label key={key}>
                    {s.name} {key}
                    <input
                      value={options.overrides[s.id]?.[key] ?? ''}
                      onChange={(e) =>
                        update({
                          ...options,
                          overrides: {
                            ...options.overrides,
                            [s.id]: { ...options.overrides[s.id], [key]: e.target.value },
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </details>
            ))}
        </details>
      </section>
      <section className="surface-card" aria-label="Collection health details">
        <div className="jobs-row">
          <div>
            <h2>Collection health</h2>
            <p className="help-text">
              {view?.discovery?.jobs ?? 0} unique jobs in run ·{' '}
              {view?.discovery?.coverage.filter((c) => c.requests > 0).length ?? 0} sources checked
              · {issues} source issues
            </p>
          </div>
          <div className="button-row">
            <button onClick={() => setDialog('help')}>What do statuses mean?</button>
            <button onClick={() => setDialog('log')}>Request Log</button>
          </div>
        </div>
        <HealthTable view={view?.discovery} />
        <p className="help-text">
          Records, discovered leads, verified company boards and unique jobs measure different work.
          A zero-match source is not necessarily unhealthy.
        </p>
      </section>
      {dialog === 'log' && (
        <RequestLog lane="jobs" sources={registry} onClose={() => setDialog(null)} />
      )}
      {dialog === 'help' && (
        <ProfileDialog title="Source status guide" onClose={() => setDialog(null)}>
          <dl>
            <dt>Ready / checked-no-new-jobs</dt>
            <dd>Accessible collection finished, including valid empty feeds.</dd>
            <dt>Skipped cached</dt>
            <dd>A complete fresh board snapshot was reused without a network refresh.</dd>
            <dt>Waiting for board</dt>
            <dd>The ATS adapter needs a verified tenant, not an API key.</dd>
            <dt>Retrying / retry scheduled</dt>
            <dd>Transient failure or origin quota; work is checkpointed for a later retry.</dd>
            <dt>Blocked</dt>
            <dd>
              Access policy, robots, challenge, permanent error or exhausted bounded retries. No
              bypass is attempted.
            </dd>
            <dt>Partial</dt>
            <dd>
              Some records/pages were unavailable. Valid siblings and saved jobs are retained.
            </dd>
          </dl>
        </ProfileDialog>
      )}
      {dialog === 'queries' && (
        <ProfileDialog title="Profile-guided queries" onClose={() => setDialog(null)}>
          <p>
            Deterministic, evidence-based discovery priorities. These do not replace eligibility or
            scoring. Up to eight lines, saved locally.
          </p>
          <label>
            Discovery query plan
            <textarea
              rows={8}
              maxLength={4000}
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button
              disabled={busy}
              onClick={() =>
                void command({ op: 'queryPlan', queries: null }).then(() => setDialog(null))
              }
            >
              Reset to profile
            </button>
            <button
              disabled={
                busy || !queries.trim() || queries.split('\n').filter((s) => s.trim()).length > 8
              }
              onClick={() =>
                void command({
                  op: 'queryPlan',
                  queries: queries
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }).then(() => setDialog(null))
              }
            >
              Save query plan
            </button>
          </div>
        </ProfileDialog>
      )}
    </section>
  );
}
