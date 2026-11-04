/** Five task-focused pages over existing validated IPC; collection never runs on filter changes. */
import { useEffect, useRef, useState } from 'react';
import type { CareerCommand, CareerViewSchema, JobSearch, SettingsView } from '@rovdo/shared';
import type { z } from 'zod';
import { JobCard } from './JobCard';
import { JobsFilters } from './JobsFilters';
import { CompaniesWorkspace, Pager, PipelineActivity } from './JobsCollection';
import { JobsScope } from './JobsScope';
import { JobsRanking } from './JobsRanking';
import { JobReview } from './JobReview';
import { ProfileDialog } from './ProfileDialog';
import { initialJobSearch, presetKey } from './jobs-state';
import { discoveryOptionsForSearch } from './discovery-search';
import { useActionState } from './action-state';
type View = z.infer<typeof CareerViewSchema>;
type Page = 'find' | 'saved' | 'ranking' | 'scope' | 'companies';
export function JobsWorkspace({
  settings,
  initialSavedOnly = false,
  onProfile,
}: {
  settings: SettingsView;
  initialSavedOnly?: boolean;
  onProfile?: () => void;
}) {
  const [page, setPage] = useState<Page>(initialSavedOnly ? 'saved' : 'find'),
    [view, setView] = useState<View | null>(null),
    [find, setFind] = useState<JobSearch>({ ...initialJobSearch }),
    [saved, setSaved] = useState<JobSearch>({ ...initialJobSearch, savedOnly: true }),
    [error, setError] = useState(''),
    [filters, setFilters] = useState(false),
    [preset, setPreset] = useState(''),
    [baseline, setBaseline] = useState(presetKey(initialJobSearch)),
    [presetModal, setPresetModal] = useState(false),
    [name, setName] = useState(''),
    [exportStatus, setExportStatus] = useState(''),
    [review, setReview] = useState('');
  const { pending: busy, run } = useActionState();
  const search = page === 'saved' ? saved : find;
  const ref = useRef({ search, page });
  ref.current = { search, page };
  const revision = useRef(0),
    pending = useRef(false);
  const defaultsLoaded = useRef(false);
  async function refresh(background = false) {
    if (background && pending.current) return;
    pending.current = true;
    const stamp = ++revision.current;
    const current = ref.current;
    try {
      const r = await window.rovdo!.careerCommand({
        op: 'view',
        search: current.search,
        summary: !['find', 'saved'].includes(current.page),
      });
      if (stamp !== revision.current) return;
      if (r.ok && !defaultsLoaded.current) {
        defaultsLoaded.current = true;
        if (r.view.collectionDefaults) {
          const defaults = r.view.collectionDefaults;
          setFind((old) => ({ ...old, scope: defaults.scope, discovery: defaults.options }));
        }
      }
      if (r.ok)
        setView((old) => ({
          ...r.view,
          matches: !['find', 'saved'].includes(current.page)
            ? (old?.matches ?? [])
            : r.view.matches,
          comparisons: old?.comparisons ?? [],
        }));
      else setError(r.code);
    } catch {
      setError('Unable to load jobs. Your cached records are preserved.');
    } finally {
      pending.current = false;
    }
  }
  const resultKey = JSON.stringify({ ...search, discovery: undefined });
  const collectionKey = JSON.stringify({ scope: find.scope, options: find.discovery });
  useEffect(() => {
    if (!defaultsLoaded.current) return;
    const timer = setTimeout(() => {
      void window
        .rovdo!.careerCommand({
          op: 'collectionSettings',
          scope: find.scope ?? 'global',
          options: find.discovery!,
        })
        .then((r) => {
          if (!r.ok) setError('Unable to save collection preferences');
        })
        .catch(() => setError('Unable to save collection preferences'));
    }, 300);
    return () => clearTimeout(timer);
  }, [collectionKey]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 200);
    return () => {
      clearTimeout(timer);
      revision.current++;
    };
  }, [resultKey, page]);
  useEffect(() => {
    const timer = setInterval(() => void refresh(true), 3000);
    return () => {
      clearInterval(timer);
      revision.current++;
    };
  }, []);
  const previousDestination = useRef(initialSavedOnly);
  useEffect(() => {
    // Initial state already honors the destination. Do not overwrite a fast user's navigation.
    if (previousDestination.current !== initialSavedOnly)
      setPage(initialSavedOnly ? 'saved' : 'find');
    previousDestination.current = initialSavedOnly;
  }, [initialSavedOnly]);
  function change(next: JobSearch) {
    if (page === 'saved') setSaved({ ...next, savedOnly: true });
    else setFind({ ...next, savedOnly: false });
  }
  async function command(cmd: CareerCommand, onSuccess?: () => void) {
    await run(
      cmd.op === 'startDiscovery' ? 'Starting collection…' : 'Saving changes…',
      async () => {
        setError('');
        try {
          const r = await window.rovdo!.careerCommand(cmd);
          if (!r.ok) {
            setError(r.code);
            return;
          }
          setView((old) => ({
            ...r.view,
            matches: old?.matches ?? [],
            matchedCount: old?.matchedCount ?? r.view.matchedCount,
            comparisons: cmd.op === 'compare' ? r.view.comparisons : (old?.comparisons ?? []),
          }));
          if (cmd.op === 'exportJobs' && r.exported)
            setExportStatus(
              `${r.exported.saved ? 'File saved for this page' : 'Export canceled'}; ${r.exported.skipped} restricted records omitted.`,
            );
          if (!['compare', 'exportJobs', 'queryPlan'].includes(cmd.op)) await refresh();
          onSuccess?.();
        } catch {
          setError('Action failed. Check the source health details and try again.');
        }
      },
    );
  }
  function collect() {
    if (busy || view?.polling || view?.discovery?.run?.status === 'running') return;
    void refresh();
    if (find.scope === 'saved-companies') void command({ op: 'searchSavedCompanies' });
    else if (find.scope === 'company' && find.selectedSourceId)
      void command({ op: 'pollCompany', id: find.selectedSourceId });
    else
      void command({
        op: 'startDiscovery',
        options: discoveryOptionsForSearch(find, initialJobSearch.discovery!),
        consent: true,
      });
  }
  const count = view?.matchedCount ?? 0;
  const limited =
    !view?.profile ||
    !(
      view.profile.facts.some((f) => f.verified && f.field === 'skill') ||
      view.profile.intelligence?.skills.some((s) => s.verified)
    );
  const activeFilters = Object.entries(search).filter(
    ([key, value]) =>
      ![
        'query',
        'within',
        'location',
        'scope',
        'discovery',
        'selectedSourceId',
        'sort',
        'savedOnly',
        'rankingId',
        'offset',
        'pageSize',
      ].includes(key) &&
      value !== undefined &&
      value !== false &&
      value !== '' &&
      value !== 'all',
  );
  function reset() {
    change({
      ...initialJobSearch,
      discovery: find.discovery,
      scope: search.scope,
      savedOnly: page === 'saved',
      rankingId: search.rankingId,
    });
  }
  const duplicate = view?.savedSearches.some(
    (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
  );
  const [includes, setIncludes] = useState({
    text: true,
    location: true,
    filters: true,
    scope: true,
    ranking: true,
  });
  function savePreset() {
    const config: JobSearch = {
      ...initialJobSearch,
      ...(includes.filters ? search : {}),
      query: includes.text ? search.query : '',
      location: includes.location ? search.location : undefined,
      scope: includes.scope ? find.scope : 'global',
      discovery: includes.scope ? find.discovery : undefined,
      rankingId: includes.ranking ? search.rankingId : undefined,
      savedOnly: false,
      offset: 0,
    };
    void command({ op: 'saveSearch', name: name.trim(), search: config }, () => {
      setBaseline(presetKey(search));
      setPresetModal(false);
    });
  }
  return (
    <div className="career-workspace jobs-v5">
      <nav className="section-nav jobs-tabs" aria-label="Jobs views">
        {(
          [
            ['find', 'Find Jobs'],
            ['saved', `Saved Jobs (${view?.savedIds.length ?? 0})`],
            ['ranking', 'Ranking Methods'],
            ['scope', 'Scope & Collection'],
            ['companies', 'Companies'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={page === id}
            onClick={() => {
              setFilters(false);
              setPage(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {(page === 'find' || page === 'saved') && (
        <section className="jobs-page" aria-label={page === 'find' ? 'Find jobs' : 'Saved jobs'}>
          <div className="jobs-row">
            <div>
              <div className="eyebrow">
                {page === 'find' ? 'FIND OPPORTUNITIES' : 'YOUR SHORTLIST'}
              </div>
              <h1>{page === 'find' ? 'Find your next job' : 'Saved Jobs'}</h1>
              <p>
                {page === 'find'
                  ? 'Search once. Rovdo handles collection and matching.'
                  : 'Your saved opportunities, notes and application history.'}
              </p>
            </div>
          </div>
          {page === 'find' && (
            <>
              {limited && (
                <div className="profile-warning">
                  <span>
                    <strong>Improve your matches</strong> · Add or verify your qualifications for
                    better evidence-based matching.
                  </span>
                  {onProfile && <button onClick={onProfile}>Review profile</button>}
                </div>
              )}
              <section className="surface-card">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    collect();
                  }}
                >
                  <div className="v5-search-form">
                    <label>
                      Search Jobs
                      <input
                        placeholder="Job title, keyword, or company"
                        value={find.query}
                        onChange={(e) => setFind({ ...find, query: e.target.value, offset: 0 })}
                      />
                    </label>
                    <label>
                      Location
                      <input
                        placeholder="Anywhere"
                        value={find.location ?? ''}
                        onChange={(e) => setFind({ ...find, location: e.target.value, offset: 0 })}
                      />
                    </label>
                    <label>
                      Job type
                      <select
                        value={find.employmentType ?? 'all'}
                        onChange={(e) =>
                          setFind({ ...find, employmentType: e.target.value, offset: 0 })
                        }
                      >
                        {[
                          'all',
                          'internship',
                          'full-time',
                          'part-time',
                          'contract',
                          'temporary',
                          'unknown',
                        ].map((v) => (
                          <option key={v} value={v}>
                            {v === 'all' ? 'All types' : v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Saved search
                      <select
                        value={preset}
                        onChange={(e) => {
                          setPreset(e.target.value);
                          const p = view?.savedSearches.find((s) => s.id === e.target.value);
                          if (p) {
                            const next = {
                              ...p.search,
                              savedOnly: false,
                              offset: 0,
                              pageSize: p.search.pageSize ?? 10,
                              discovery: p.search.discovery ?? find.discovery,
                            };
                            setFind(next);
                            setBaseline(presetKey(next));
                          }
                        }}
                      >
                        <option value="">Custom search</option>
                        {view?.savedSearches.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        view?.polling ||
                        view?.discovery?.run?.status === 'running' ||
                        (find.scope === 'company' && !find.selectedSourceId) ||
                        (find.scope === 'global' && !find.discovery?.sourceIds.length)
                      }
                    >
                      Find Jobs
                    </button>
                  </div>
                </form>
                <div className="jobs-row search-bottom">
                  <div className="button-row">
                    <button onClick={() => setFilters(true)}>
                      All Filters {activeFilters.length ? `(${activeFilters.length})` : ''}
                    </button>
                    <button
                      disabled={presetKey(find) === baseline}
                      onClick={() => {
                        setName('');
                        setPresetModal(true);
                      }}
                    >
                      Save search preset
                    </button>
                  </div>
                  <span className="help-text">
                    Scope:{' '}
                    {find.scope === 'saved-companies'
                      ? 'Search All Saved Companies'
                      : find.scope === 'company'
                        ? 'Selected Company'
                        : 'Search All'}
                  </span>
                </div>
                {!!activeFilters.length && (
                  <div className="jobs-chips">
                    {activeFilters.map(([key, value]) => (
                      <button
                        key={key}
                        onClick={() => {
                          const next = { ...search };
                          if (key === 'company') next.company = '';
                          else if (key === 'workMode') next.workMode = 'all';
                          else delete next[key as keyof JobSearch];
                          change({ ...next, offset: 0 });
                        }}
                      >
                        {key}: {String(value)} ×
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <PipelineActivity
                view={view?.discovery}
                lane="jobs"
                command={command}
                busy={busy}
                onHealth={() => setPage('scope')}
              />
              {view?.polling && (
                <p role="status">Refreshing saved-company feeds. Cached jobs remain visible.</p>
              )}
            </>
          )}
          {page === 'saved' && view && !view.savedIds.length ? (
            <section className="empty-state surface-card">
              <h2>No saved jobs yet</h2>
              <p>Save an opportunity from Find Jobs to keep it here.</p>
              <button onClick={() => setPage('find')}>Find Jobs</button>
            </section>
          ) : (
            <>
              <div className="job-results-toolbar">
                <div>
                  <h2>
                    {count} {page === 'saved' ? 'saved jobs' : 'matching jobs'}
                  </h2>
                  {!!view?.rankingPending && (
                    <p className="help-text" role="status">
                      Matching {view.rankingPending} remaining jobs…
                    </p>
                  )}
                </div>
                <input
                  aria-label={page === 'saved' ? 'Search saved jobs' : 'Search within results'}
                  placeholder="Search within results"
                  value={search.within ?? ''}
                  onChange={(e) => change({ ...search, within: e.target.value, offset: 0 })}
                />
                {page === 'saved' && <button onClick={() => setFilters(true)}>All Filters</button>}
                <label>
                  Sort results
                  <select
                    value={search.sort ?? 'qualification'}
                    onChange={(e) =>
                      change({ ...search, sort: e.target.value as JobSearch['sort'], offset: 0 })
                    }
                  >
                    {[
                      ['qualification', 'Best match'],
                      ['newest', 'Newest'],
                      ['salary', 'Salary'],
                      ['company', 'Company'],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Results per page
                  <select
                    value={search.pageSize ?? 10}
                    onChange={(e) =>
                      change({
                        ...search,
                        pageSize: Number(e.target.value) as 10 | 25 | 50,
                        offset: 0,
                      })
                    }
                  >
                    {[10, 25, 50].map((v) => (
                      <option key={v} value={v}>
                        {v} / page
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!view ? (
                <p role="status">Loading indexed jobs…</p>
              ) : !count && !view.rankingPending ? (
                <section className="surface-card empty-state">
                  <h2>No matching jobs</h2>
                  <p>
                    {view.totalJobs
                      ? 'Your filters exclude the indexed opportunities. Try broader criteria or reset filters.'
                      : 'Your index is empty. Find Jobs collects enabled public feeds while Companies discovers additional ATS boards.'}
                  </p>
                  <div className="button-row">
                    <button onClick={reset}>Reset filters</button>
                    <button onClick={() => setPage('scope')}>Review source health</button>
                  </div>
                </section>
              ) : (
                <div className="job-results">
                  {view.matches.map((m) => (
                    <JobCard
                      key={m.job.id}
                      match={m}
                      saved={view.savedIds.includes(m.job.id)}
                      marker={view.markers.find((k) => k.jobId === m.job.id)}
                      rankings={view.rankingProfiles}
                      reviews={view.reviews}
                      compareId="builtin:technical-balanced"
                      command={command}
                      onReview={() => setReview(m.job.id)}
                      busy={busy}
                    />
                  ))}
                </div>
              )}
              {!!view?.comparisons.length && (
                <section className="surface-card" aria-label="Ranking comparison">
                  {view.comparisons.map((m) => (
                    <p key={m.ranking?.configId}>
                      {m.ranking?.configId}: {m.score.toFixed(1)} / 100
                    </p>
                  ))}
                </section>
              )}
              <Pager
                offset={search.offset ?? 0}
                size={search.pageSize ?? 10}
                total={count}
                onChange={(offset) => change({ ...search, offset })}
              />
              <details className="jobs-export">
                <summary>Export current page</summary>
                <div className="button-row">
                  <button
                    disabled={!view?.matches.length}
                    onClick={() => void command({ op: 'exportJobs', format: 'csv', search })}
                  >
                    Export page CSV
                  </button>
                  <button
                    disabled={!view?.matches.length}
                    onClick={() => void command({ op: 'exportJobs', format: 'json', search })}
                  >
                    Export page JSON
                  </button>
                </div>
                {exportStatus && <p role="status">{exportStatus}</p>}
              </details>
            </>
          )}
        </section>
      )}
      {page === 'ranking' && <JobsRanking view={view} onChanged={() => void refresh()} />}
      {page === 'scope' && (
        <JobsScope view={view} search={find} onChange={setFind} command={command} busy={busy} />
      )}
      {page === 'companies' && <CompaniesWorkspace view={view} command={command} busy={busy} />}
      {filters && (
        <JobsFilters
          companySuggestions={view?.rankingJobs?.map((j) => j.company) ?? []}
          search={search}
          onChange={change}
          total={count}
          onClose={() => setFilters(false)}
        />
      )}
      {presetModal && (
        <ProfileDialog title="Save search preset" onClose={() => setPresetModal(false)}>
          <label>
            Preset name
            <input
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer embedded internships"
            />
          </label>
          <p>Include these settings:</p>
          {Object.entries(includes).map(([key, value]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => setIncludes({ ...includes, [key]: e.target.checked })}
              />
              {key === 'text' ? 'Search text and job type' : key}
            </label>
          ))}
          {duplicate && <p role="alert">A preset already uses this name. Choose another name.</p>}
          <button disabled={busy || !name.trim() || duplicate} onClick={savePreset}>
            Save preset
          </button>
          {preset && (
            <button
              onClick={() =>
                void command({ op: 'deleteSearch', id: preset }, () => {
                  setPreset('');
                  setPresetModal(false);
                })
              }
            >
              Delete selected saved search
            </button>
          )}
        </ProfileDialog>
      )}
      {review && view && (
        <JobReview
          jobId={review}
          view={view}
          settings={settings}
          command={command}
          onClose={() => setReview('')}
        />
      )}
    </div>
  );
}
