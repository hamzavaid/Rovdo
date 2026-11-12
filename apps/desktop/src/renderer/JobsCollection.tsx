/** Real queue state and company inventory, kept separate from result filtering. */
import { useEffect, useState } from 'react';
import type {
  CareerCommand,
  CareerViewSchema,
  DiscoveryViewSchema,
  CompanyQuerySchema,
} from '@rovdo/shared';
import type { z } from 'zod';
import { ProfileDialog } from './ProfileDialog';
import { dateLabel } from './jobs-state';
import { StarterEmployerDirectory } from './StarterEmployerDirectory';
import { ManualJobSource } from './ManualJobSource';
type View = z.infer<typeof CareerViewSchema>;
type Discovery = z.infer<typeof DiscoveryViewSchema>;
type Command = (c: CareerCommand) => Promise<void>;
const jobStages = [
  ['prepare', 'Preparing your search'],
  ['acquire', 'Finding opportunities'],
  ['verify', 'Checking job details'],
  ['eligibility', 'Checking eligibility'],
  ['rank', 'Matching your profile'],
  ['publish', 'Updating results'],
];
const companyStages = [
  ['discover', 'Finding board URLs'],
  ['identify', 'Identifying employers'],
  ['validate', 'Verifying live feeds'],
  ['register', 'Saving verified boards'],
];
export function PipelineActivity({
  view,
  lane,
  command,
  busy,
  onHealth,
}: {
  view: Discovery | undefined;
  lane: 'jobs' | 'companies';
  command: Command;
  busy: boolean;
  onHealth?: () => void;
}) {
  const run = view?.run;
  const issues = view?.coverage.filter((c) => c.error).length ?? 0;
  const active = run?.status === 'running';
  const action = (action: 'pause' | 'resume' | 'cancel') =>
    lane === 'jobs' && run
      ? command({ op: 'controlDiscovery', id: run.id, action })
      : command({ op: 'companyDiscovery', action });
  return (
    <section
      className="surface-card pipeline-activity"
      aria-label={lane === 'jobs' ? 'Discovery progress' : 'Company discovery progress'}
      aria-live="polite"
    >
      <div className="jobs-row">
        <div>
          <h2>
            {!run
              ? 'Ready to search'
              : active
                ? lane === 'jobs'
                  ? 'Collection in progress'
                  : 'Company discovery in progress'
                : run.status === 'completed'
                  ? issues
                    ? 'Collection finished with unavailable sources'
                    : 'Collection completed'
                  : `Collection ${run.status}`}
          </h2>
          <p className="help-text">
            {lane === 'jobs'
              ? 'Cached jobs remain available during collection.'
              : 'Scheduled independently. Job searches take priority over archive requests.'}
          </p>
        </div>
        <div className="button-row">
          {active && (
            <>
              <button disabled={busy} onClick={() => void action('pause')}>
                Pause
              </button>
              <button disabled={busy} onClick={() => void action('cancel')}>
                Stop
              </button>
            </>
          )}
          {run?.status === 'paused' && (
            <>
              <button disabled={busy} onClick={() => void action('resume')}>
                Resume
              </button>
              <button disabled={busy} onClick={() => void action('cancel')}>
                Stop
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className="pipeline-segments"
        aria-label={lane === 'jobs' ? 'Six job search stages' : 'Company discovery stages'}
      >
        {(lane === 'jobs' ? jobStages : companyStages).map(([id, label]) => {
          const event = view?.events?.filter((e) => e.stage === id).at(-1);
          return (
            <div
              key={id}
              className={`pipeline-stage ${event?.status ?? 'queued'} ${active && event?.status === 'running' ? 'active' : ''}`}
            >
              <span>{label}</span>
              <small>{event ? `${event.status} · ${event.count}` : 'Not run'}</small>
            </div>
          );
        })}
      </div>
      <div className="collection-counters">
        <span>{view?.jobs ?? 0} unique jobs in this run</span>
        {view?.metrics && (
          <>
            <span>{view.metrics.newJobs ?? 0} new jobs</span>
            <span>{view.metrics.updatedJobs ?? 0} updated jobs</span>
            <span>{view.metrics.knownBoards ?? 0} verified boards in inventory</span>
          </>
        )}
        <span>{view?.coverage.filter((c) => c.requests > 0).length ?? 0} sources checked</span>
        <span>{issues} source issues</span>
        <span>{view?.pending ?? 0} pending tasks</span>
      </div>
      <div className="jobs-row">
        <details>
          <summary>Activity details</summary>
          {view?.events?.length ? (
            view.events.map((e) => (
              <p className="help-text" key={e.sequence}>
                {dateLabel(e.at)} · {e.stage} · {e.status} · {e.count}
                {e.reason ? ` · ${e.reason}` : ''}
              </p>
            ))
          ) : (
            <p className="help-text">No recorded activity yet.</p>
          )}
          {view?.metrics && (
            <dl className="pipeline-metrics">
              {Object.entries(view.metrics).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                  <dd>{Number.isInteger(value) ? value : value.toFixed(3)}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
        {onHealth && (
          <button className="text-action" onClick={onHealth}>
            Source health
          </button>
        )}
      </div>
    </section>
  );
}
export function RequestLog({
  lane,
  sources,
  onClose,
}: {
  lane: 'jobs' | 'companies';
  sources: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [source, setSource] = useState(''),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<{ rows: View['requests']; total: number }>({ rows: [], total: 0 }),
    [error, setError] = useState('');
  useEffect(() => {
    let stale = false;
    void window
      .rovdo!.careerCommand({ op: 'requestLog', lane, sourceId: source || undefined, offset })
      .then((r) => {
        if (stale) return;
        if (r.ok) setData({ rows: r.view.requests, total: r.view.requestTotal });
        else setError(r.code);
      })
      .catch(() => {
        if (!stale) setError('Unable to read request history');
      });
    return () => {
      stale = true;
    };
  }, [lane, source, offset]);
  return (
    <ProfileDialog title="Request Log" onClose={onClose} closeLabel="Close request log">
      <label>
        Source
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <p className="help-text">
        Bounded local history. Query strings and response bodies are omitted.
      </p>
      {data.rows.map((r) => (
        <article className="request-record" key={r.sequence}>
          <strong>
            {r.sourceId} · {r.status ?? r.error}
          </strong>
          <small>
            {dateLabel(r.at)} · {Math.round(r.durationMs)} ms · {r.bytes} bytes
          </small>
          <code>{r.target}</code>
        </article>
      ))}
      {!data.rows.length && <p>No recorded requests for this selection.</p>}
      <Pager offset={offset} size={25} total={data.total} onChange={setOffset} />
    </ProfileDialog>
  );
}
export function HealthTable({ view }: { view: Discovery | undefined }) {
  return (
    <div className="table-scroll">
      <table className="collection-health">
        <thead>
          <tr>
            <th>Source</th>
            <th>Status</th>
            <th>Requests</th>
            <th>Records</th>
            <th>Rejected</th>
            <th>Reason</th>
            <th>Last update</th>
            <th>Last success</th>
            <th>Next refresh</th>
          </tr>
        </thead>
        <tbody>
          {view?.coverage.map((c) => (
            <tr key={c.sourceId}>
              <th>{view.registry.find((s) => s.id === c.sourceId)?.name ?? c.sourceId}</th>
              <td>{c.status}</td>
              <td>{c.requests}</td>
              <td>{c.records}</td>
              <td>{c.rejected}</td>
              <td>{c.error ?? 'None'}</td>
              <td>{dateLabel(c.updatedAt)}</td>
              <td>{dateLabel(c.lastSuccessAt)}</td>
              <td>{dateLabel(c.nextRefreshAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!view?.coverage.length && <p className="help-text">No collection has run yet.</p>}
    </div>
  );
}
export function Pager({
  offset,
  size,
  total,
  onChange,
}: {
  offset: number;
  size: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="jobs-pager">
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>
        Previous
      </button>
      <span>
        {total ? `${offset + 1}–${Math.min(offset + size, total)} of ${total}` : '0 results'}
      </span>
      <button disabled={offset + size >= total} onClick={() => onChange(offset + size)}>
        Next
      </button>
    </div>
  );
}
/** Saved/approved sources predate the discovery inventory and remain visible independently. */
function SavedEmployerDirectory({ entries }: { entries: View['directory'] }) {
  const [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0);
  const rows = entries.filter((e) =>
    `${e.company} ${e.ats} ${e.tenant}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="surface-card" aria-labelledby="saved-directory-title">
      <h2 id="saved-directory-title">Saved employer directory</h2>
      <p className="help-text">
        All saved directory entries, including public career pages and sources not yet in the
        live-board inventory. Policy approval and historical verification do not guarantee current
        availability.
      </p>
      <label>
        Search saved directory
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <p className="help-text">{rows.length} saved directory sources</p>
      {rows.slice(offset, offset + 25).map((e) => (
        <article className="company-directory-card" key={e.id}>
          <h3>
            {e.company || 'Employer name pending'}{' '}
            <small>
              {e.ats} / {e.tenant}
            </small>
          </h3>
          <p className="help-text">
            Policy: {e.policy} · Last verification: {dateLabel(Date.parse(e.verifiedAt))}
          </p>
          <p className="help-text company-source-url">{e.pageUrl ?? e.reference}</p>
        </article>
      ))}
      {!rows.length && <p>No saved directory sources match.</p>}
      <Pager offset={offset} size={25} total={rows.length} onChange={setOffset} />
    </section>
  );
}
export function CompaniesWorkspace({
  view,
  command,
  busy,
}: {
  view: View | null;
  command: Command;
  busy: boolean;
}) {
  const [query, setQuery] = useState<z.infer<typeof CompanyQuerySchema>>({
    query: '',
    provider: 'all',
    status: 'all',
    offset: 0,
    limit: 25,
  });
  const [page, setPage] = useState(view?.companyPage),
    [error, setError] = useState(''),
    [log, setLog] = useState(false),
    [manual, setManual] = useState(false);
  const [url, setUrl] = useState(''),
    [company, setCompany] = useState(''),
    [policy, setPolicy] = useState(''),
    [permitted, setPermitted] = useState(false);
  useEffect(() => {
    let stale = false;
    const load = () => {
      void window
        .rovdo!.careerCommand({ op: 'companyPage', query })
        .then((r) => {
          if (!stale) {
            if (r.ok) setPage(r.view.companyPage);
            else setError(r.code);
          }
        })
        .catch(() => {
          if (!stale) setError('Unable to load directory');
        });
    };
    const timer = setTimeout(load, 200),
      poll = setInterval(load, 5000);
    return () => {
      stale = true;
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [query, view?.companyPage?.verified, view?.companyDiscovery?.run?.updatedAt]);
  async function change(
    identity: string,
    action: 'enable' | 'disable' | 'retire' | 'refresh' | 'interval' | 'test',
    intervalMs?: number,
  ) {
    await command({ op: 'companyBoard', identity, action, intervalMs });
    const r = await window.rovdo!.careerCommand({ op: 'companyPage', query });
    if (r.ok) setPage(r.view.companyPage);
  }
  return (
    <section className="jobs-page">
      <div className="jobs-row">
        <div>
          <h1>Companies</h1>
          <p>Automatic discovery builds a reusable directory of public employer boards.</p>
        </div>
        <div className="company-header-actions">
          <button onClick={() => setManual(true)}>+ Verify company URL</button>
          <button onClick={() => setLog(true)}>Request Log</button>
        </div>
      </div>
      <div className="button-row">
        <button
          disabled={
            busy || ['running', 'paused'].includes(view?.companyDiscovery?.run?.status ?? '')
          }
          onClick={() => void command({ op: 'companyDiscovery', action: 'start' })}
        >
          Discover more boards
        </button>
        <label>
          <input
            type="checkbox"
            checked={view?.automaticCompanyDiscovery ?? true}
            onChange={(e) =>
              void command({
                op: 'companyDiscovery',
                action: 'automatic',
                enabled: e.target.checked,
              })
            }
          />
          Automatic company discovery
        </label>
      </div>
      <PipelineActivity
        view={view?.companyDiscovery}
        lane="companies"
        command={command}
        busy={busy}
      />
      <div className="company-metrics">
        {[
          [page?.verified, 'Verified boards'],
          [page?.enabled, 'Enabled verified boards'],
          [page?.due, 'Due for refresh'],
        ].map(([count, label]) => (
          <div className="surface-card" key={label}>
            <strong>{count ?? '—'}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="surface-card" aria-labelledby="verified-directory-title">
        <h2 id="verified-directory-title">Verified Source Directory</h2>
        <p className="help-text">
          Pending leads, verified tenants and employer names are distinct. Disabling or removing a
          board preserves its opt-out and saved jobs.
        </p>
        <div className="company-filters">
          <label>
            Search companies
            <input
              value={query.query}
              onChange={(e) => setQuery({ ...query, query: e.target.value, offset: 0 })}
            />
          </label>
          <label>
            ATS provider
            <select
              value={query.provider}
              onChange={(e) =>
                setQuery({ ...query, provider: e.target.value as typeof query.provider, offset: 0 })
              }
            >
              {['all', 'greenhouse', 'lever', 'ashby', 'smartrecruiters'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={query.status}
              onChange={(e) =>
                setQuery({ ...query, status: e.target.value as typeof query.status, offset: 0 })
              }
            >
              {['all', 'enabled', 'disabled', 'due', 'pending'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Companies per page
            <select
              value={query.limit}
              onChange={(e) =>
                setQuery({ ...query, limit: Number(e.target.value) as 10 | 25 | 50, offset: 0 })
              }
            >
              {[10, 25, 50].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <p className="help-text" role="status">
          {page?.total ?? 0} boards match. Showing {page?.rows.length ? query.offset + 1 : 0}–
          {query.offset + (page?.rows.length ?? 0)}. Use the page controls to browse the complete
          inventory.
        </p>
        {page?.rows.map((b) => (
          <article className="company-directory-card" key={b.identity}>
            <div className="jobs-row">
              <h3>
                {b.company || 'Employer name pending'}{' '}
                <small>
                  {b.ats} / {b.tenant}
                </small>
              </h3>
              <div className="button-row">
                <button
                  disabled={busy || !b.enabled}
                  onClick={() => void change(b.identity, 'test')}
                >
                  Test
                </button>
                <button
                  disabled={busy}
                  onClick={() => void change(b.identity, b.enabled ? 'disable' : 'enable')}
                >
                  {b.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="source-remove"
                  aria-label={`Remove ${b.company || b.tenant}`}
                  disabled={busy}
                  onClick={() => void change(b.identity, 'retire')}
                >
                  ×
                </button>
              </div>
            </div>
            <p className="help-text">
              {b.validatedAt ? 'Live tenant verified' : 'Unverified lead'} · Name: {b.nameStatus} ·{' '}
              {b.health}
              {b.retiredAt ? ' · Removed by user' : ''}
            </p>
            <p className="help-text">
              Last success: {dateLabel(b.lastSuccess)} · Next refresh:{' '}
              {dateLabel(Math.max(b.nextRefresh, b.retryAt))}
            </p>
            <details>
              <summary>Board settings and provenance</summary>
              <code>{b.pageUrl}</code>
              <p>
                First seen {dateLabel(b.discoveredAt)} · Origin: {b.origin}
              </p>
              <label>
                Refresh interval
                <select
                  value={b.intervalMs}
                  onChange={(e) => void change(b.identity, 'interval', Number(e.target.value))}
                >
                  {[
                    [3600000, 'Hourly'],
                    [21600000, 'Every 6 hours'],
                    [86400000, 'Daily'],
                    [604800000, 'Weekly'],
                  ].map(([n, l]) => (
                    <option key={n} value={n}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy || !b.enabled}
                onClick={() => void change(b.identity, 'refresh')}
              >
                Refresh on next search
              </button>
              <p className="help-text">
                Technical verification does not grant saved-company polling permission. Incomplete
                snapshots cannot close missing jobs.
              </p>
            </details>
          </article>
        ))}
        {!page?.rows.length && (
          <p>
            No companies match this selection. Discovery can continue independently of Find Jobs.
          </p>
        )}
        <Pager
          offset={query.offset}
          size={query.limit}
          total={page?.total ?? 0}
          onChange={(offset) => setQuery({ ...query, offset })}
        />
      </section>
      <StarterEmployerDirectory initial={view?.starterDirectoryPage} />
      <SavedEmployerDirectory entries={view?.directory ?? []} />
      <section className="surface-card" aria-labelledby="advanced-source-title">
        <h2 id="advanced-source-title">Advanced Source Management</h2>
        <ManualJobSource command={command} busy={busy} />
        <p className="help-text">
          Optional saved-company polling controls. Removing a source preserves collected jobs, saved
          opportunities and the opt-out record.
        </p>
        {view?.sources.map((s) => (
          <article className="company-directory-card" key={s.config.id}>
            <div className="jobs-row">
              <h3>{s.config.company}</h3>
              <div className="button-row">
                <button
                  disabled={busy}
                  onClick={() =>
                    void command({
                      op: 'saveSource',
                      source: { ...s.config, enabled: !s.config.enabled },
                    })
                  }
                >
                  {s.config.enabled ? 'Disable source' : 'Enable source'}
                </button>
                <button
                  aria-label={`Delete source ${s.config.company}`}
                  disabled={busy}
                  onClick={() => void command({ op: 'deleteSource', id: s.config.id })}
                >
                  ×
                </button>
              </div>
            </div>
            <p className="help-text">
              {s.state.status} · {s.state.error ?? 'No recorded failure'} · Last success{' '}
              {dateLabel(s.state.lastSuccessAt)} · Next refresh {dateLabel(s.state.nextPollAt)}
            </p>
            <button
              disabled={busy || !s.config.enabled}
              onClick={() => void command({ op: 'pollCompany', id: s.config.id })}
            >
              Refresh saved company
            </button>
          </article>
        ))}
      </section>
      <details className="surface-card">
        <summary>Company discovery health</summary>
        <HealthTable view={view?.companyDiscovery} />
      </details>
      {log && (
        <RequestLog
          lane="companies"
          sources={view?.companyDiscovery?.registry ?? []}
          onClose={() => setLog(false)}
        />
      )}
      {manual && (
        <ProfileDialog title="Verify company URL" onClose={() => setManual(false)}>
          <p>
            Only permitted public feeds and JobPosting pages are supported. Review the source terms
            before registering.
          </p>
          <label>
            Company name
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label>
            Public careers URL
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label>
            Policy reference URL
            <input type="url" value={policy} onChange={(e) => setPolicy(e.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={permitted}
              onChange={(e) => setPermitted(e.target.checked)}
            />
            I reviewed and permit read-only access
          </label>
          <button
            disabled={busy || !permitted || !company || !url || !policy}
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
            Verify permitted source
          </button>
        </ProfileDialog>
      )}
    </section>
  );
}
