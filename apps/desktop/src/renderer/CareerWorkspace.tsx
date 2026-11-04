import { discoveryOptionsForSearch } from './discovery-search';
/**
 * Profile and jobs workspace: local drafts, search/filter state and career command coordination.
 * Backend views remain authoritative; a synchronous action gate prevents duplicate in-flight UI actions.
 */
import { useEffect, useRef, useState } from 'react';
import { emptyProfile, reviewPayload, reviewRequestHash } from '@rovdo/career';
import { CandidateProfileSchema, ProfileFactSchema } from '@rovdo/shared';
import type {
  CandidateProfile,
  CareerCommand,
  CareerViewSchema,
  JobSearch,
  ProfileFact,
  SettingsView,
  SourceConfig,
} from '@rovdo/shared';
import type { z } from 'zod';
import { JobCard } from './JobCard';
import { GlobalDiscovery, defaultDiscovery } from './GlobalDiscovery';
import { CollectionActivity } from './CollectionActivity';
import { AdvancedFilters, DiscoveryControls } from './DiscoveryControls';
import { LegacyFacts } from './LegacyFacts';
import { QualificationComposer } from './QualificationComposer';
import { SkillsPanel } from './SkillsPanel';
import { useActionState } from './action-state';
import { OperationStatus } from './OperationStatus';
import { ProfileQualifications } from './ProfileQualifications';
import { ProfileIntelligence } from './ProfileIntelligence';

const initialSearch: JobSearch = {
  scope: 'global',
  discovery: defaultDiscovery,
  query: '',
  company: '',
  workMode: 'all',
  savedOnly: false,
  includeExcluded: false,
  offset: 0,
};
const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export function CareerWorkspace({
  tab,
  settings,
  initialSavedOnly = false,
}: {
  initialSavedOnly?: boolean;
  tab: 'profile' | 'jobs';
  settings: SettingsView;
}) {
  const [view, setView] = useState<z.infer<typeof CareerViewSchema> | null>(null);
  const [profile, setProfile] = useState<CandidateProfile>(emptyProfile);
  const loaded = useRef(false);
  const [rolesText, setRolesText] = useState('');
  const [excludedText, setExcludedText] = useState('');
  const [locationsText, setLocationsText] = useState('');
  function setDraft(input: CandidateProfile) {
    setProfile(input);
    setRolesText(input.preferences.roles.join(', '));
    setExcludedText(input.preferences.excludedRoles.join(', '));
    setLocationsText(input.preferences.locations.join(', '));
    setPreferredCompanies(input.preferences.preferredCompanies?.join(', ') ?? '');
    setExcludedCompanies(input.preferences.excludedCompanies?.join(', ') ?? '');
  }
  const [preferredCompanies, setPreferredCompanies] = useState('');
  const [excludedCompanies, setExcludedCompanies] = useState('');
  const [search, setSearch] = useState({ ...initialSearch, savedOnly: initialSavedOnly });
  const searchRef = useRef(search);
  searchRef.current = search;
  const [error, setError] = useState('');
  const { pending: busy, label: actionLabel, run } = useActionState();
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [importText, setImportText] = useState('');
  const [field, setField] = useState<ProfileFact['field']>('skill');
  const [tenant, setTenant] = useState('');
  const [company, setCompany] = useState('');
  const [ats, setAts] = useState<SourceConfig['ats']>('greenhouse');
  const [region, setRegion] = useState<SourceConfig['region']>('global');
  const [interval, setIntervalMinutes] = useState(1440);
  const [terms, setTerms] = useState(false);
  const searchScope = search.scope ?? 'saved-companies';
  const [exportStatus, setExportStatus] = useState('');
  const [jobView, setJobView] = useState<'results' | 'saved' | 'sources'>(
    initialSavedOnly ? 'saved' : 'results',
  );
  const [profileSection, setProfileSection] = useState('skills');
  const [rankingOpen, setRankingOpen] = useState(false);
  const [previewRankingId, setPreviewRankingId] = useState('builtin:legacy-v1');
  const [previewJobId, setPreviewJobId] = useState('');
  const [compareId, setCompareId] = useState('builtin:legacy-v1');
  const [model, setModel] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [consent, setConsent] = useState(false);
  const [reviewHash, setReviewHash] = useState('');
  const refreshPending = useRef(0);
  const refreshRevision = useRef(0);
  const refresh = async (background = false) => {
    if (background && refreshPending.current) return;
    refreshPending.current++;
    const revision = ++refreshRevision.current;
    const criteria = searchRef.current;
    try {
      const result = await window.rovdo!.careerCommand({
        op: 'view',
        search: criteria,
        summary: tab === 'profile',
      });
      if (
        revision !== refreshRevision.current ||
        JSON.stringify({ ...criteria, discovery: undefined }) !==
          JSON.stringify({ ...searchRef.current, discovery: undefined })
      )
        return;
      if (result.ok) {
        setView(result.view);
        if (!loaded.current) {
          setDraft(result.view.profile ?? emptyProfile());
          loaded.current = true;
        }
      } else setError(result.code);
    } finally {
      refreshPending.current--;
    }
  };
  useEffect(() => {
    loaded.current = false;
    if (tab === 'jobs') {
      // Honor the navigation destination when returning from Profile or the dashboard.
      setJobView(initialSavedOnly ? 'saved' : 'results');
      const next = { ...searchRef.current, savedOnly: initialSavedOnly, offset: 0 };
      searchRef.current = next;
      setSearch(next);
    }
    const load = async () => {
      try {
        await refresh(true);
      } catch {
        setError('Desktop unavailable');
      }
    };
    void load();
    const timer =
      tab === 'jobs'
        ? setInterval(() => {
            void load();
          }, 5000)
        : null;
    return () => {
      if (timer) clearInterval(timer);
    };
    // Result-filter changes have their own debounced read; polling reads the current ref.
  }, [tab, initialSavedOnly]);
  async function command(cmd: CareerCommand) {
    if (
      view?.polling &&
      ['searchAll', 'searchSavedCompanies', 'pollCompany', 'poll', 'discoverFeeds'].includes(cmd.op)
    )
      return;
    const label = ['searchAll', 'searchSavedCompanies', 'pollCompany'].includes(cmd.op)
      ? 'Checking employer feeds...'
      : cmd.op === 'startDiscovery'
        ? 'Starting qualification-driven discovery...'
        : cmd.op === 'controlDiscovery'
          ? 'Updating collection checkpoint...'
          : cmd.op === 'discoverFeeds'
            ? 'Verifying employer source...'
            : cmd.op === 'compare'
              ? 'Calculating ranking comparison...'
              : cmd.op === 'evaluate'
                ? 'Evaluating saved job...'
                : cmd.op === 'saveProfile'
                  ? 'Saving candidate profile...'
                  : 'Saving changes...';
    await run(label, async () => {
      setError('');
      try {
        const result = await window.rovdo!.careerCommand(cmd);
        if (!result.ok) {
          setError(result.code);
          return;
        }
        setView((previous) =>
          tab === 'jobs' && previous
            ? {
                ...result.view,
                matches: previous.matches,
                matchedCount: previous.matchedCount,
                rankingPending: previous.rankingPending,
              }
            : result.view,
        );
        if ((cmd.op === 'saveProfile' || cmd.op === 'proposeFacts') && result.view.profile)
          setDraft(result.view.profile);
        if (cmd.op === 'exportJobs' && result.exported)
          setExportStatus(
            `${result.exported.saved ? 'File saved for this page' : 'Export canceled'}; ${result.exported.skipped} source-restricted records omitted.`,
          );
        if (tab === 'jobs' && !['compare', 'exportJobs'].includes(cmd.op)) await refresh();
      } catch {
        setError('Invalid input or desktop unavailable');
      }
    });
  }
  async function applySearch(next: JobSearch) {
    setSearch(next);
    searchRef.current = next;
  }
  // Debounce local retrieval, not collection. Source selection does not change result criteria.
  const resultKey = JSON.stringify({ ...search, discovery: undefined });
  useEffect(() => {
    if (tab !== 'jobs') return;
    const timer = setTimeout(() => {
      void refresh().catch(() => setError('Search failed. Try again.'));
    }, 250);
    return () => clearTimeout(timer);
    // The ref always supplies the latest criteria; only result-affecting changes schedule a read.
  }, [resultKey, tab]);
  function selectJobView(next: typeof jobView) {
    setJobView(next);
    setRankingOpen(false);
    if (next !== 'sources')
      void applySearch({ ...searchRef.current, savedOnly: next === 'saved', offset: 0 });
  }
  function showCollectionHealth() {
    setJobView('sources');
    requestAnimationFrame(() => {
      const summary = document.querySelector<HTMLElement>('.discovery-progress summary');
      summary?.focus();
      summary?.scrollIntoView({ block: 'start' });
    });
  }
  function preferences(change: Partial<CandidateProfile['preferences']>) {
    setProfile({ ...profile, preferences: { ...profile.preferences, ...change } });
  }
  const factSection = (field: ProfileFact['field']) =>
    field === 'skill'
      ? 'skills'
      : field === 'experience'
        ? 'experience'
        : ['education', 'degree', 'graduationYear', 'returnToSchool'].includes(field)
          ? 'education'
          : ['project', 'link'].includes(field)
            ? 'projects'
            : 'identity';
  function resetFilters() {
    void applySearch({
      ...initialSearch,
      scope: search.scope,
      discovery: search.discovery,
      selectedSourceId: search.selectedSourceId,
      rankingId: search.rankingId,
      savedOnly: jobView === 'saved',
    });
  }
  const reviewMatch = view?.matches.find((m) => m.job.id === reviewId);
  const reviewJob = reviewMatch?.job;
  const reviewRanking = view?.rankingProfiles.find((p) => p.id === reviewMatch?.ranking?.configId);
  const reviewAsOf = reviewMatch?.ranking?.asOf;
  const selectedModel = settings.profiles.find((p) => p.config.id === model)?.config;
  const outbound =
    reviewJob && view?.profile && reviewRanking && reviewAsOf
      ? reviewPayload(view.profile, [reviewJob], {
          ranking: reviewRanking,
          asOf: reviewAsOf,
          retrieval: { [reviewJob.id]: reviewMatch!.bm25Raw },
        })
      : null;
  const reviewSignature = JSON.stringify({ outbound, model: selectedModel });
  useEffect(() => {
    setConsent(false);
    setReviewHash('');
    let stale = false;
    if (outbound && selectedModel)
      void reviewRequestHash(outbound, selectedModel).then((hash) => {
        if (!stale) setReviewHash(hash);
      });
    return () => {
      stale = true;
    };
  }, [reviewSignature]);
  return (
    <div className="career-workspace">
      {error && <p role="alert">{error}</p>}
      <OperationStatus
        label={
          actionLabel ??
          (tab === 'jobs' && jobView === 'results' && view?.polling
            ? 'Collecting and parsing job feeds...'
            : !view && !error
              ? 'Loading workspace...'
              : null)
        }
        detail={
          view?.polling
            ? `${
                view.sources
                  .filter((s) => s.state.status === 'POLLING')
                  .map((s) => s.config.company)
                  .join(', ') || 'Waiting for the next source'
              } / ${view.totalJobs} jobs indexed. Results update as feeds finish.`
            : busy
              ? 'Please wait. This action is already in progress.'
              : undefined
        }
      />
      <fieldset
        className="action-surface"
        disabled={busy || (!view && !error)}
        aria-busy={busy || !!view?.polling}
      >
        {tab === 'profile' ? (
          <>
            <div className="eyebrow">YOUR VERIFIED INFORMATION</div>
            <h1>Candidate profile</h1>
            <p>
              Only facts you explicitly verify influence matching. Citizenship and work
              authorization must be entered by you. Imported proposals never replace verified facts.
            </p>
            <p>Profile version {view?.profile?.version ?? 'not saved'}</p>
            <nav className="section-nav" aria-label="Profile sections">
              {[
                ['skills', 'Skills'],
                ['experience', 'Experience'],
                ['education', 'Education'],
                ['projects', 'Projects'],
                ['preferences', 'Preferences'],
                ['imports', 'Imports'],
                ['identity', 'Identity & eligibility'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={profileSection === id}
                  onClick={() => setProfileSection(id!)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div hidden={profileSection !== 'imports'}>
              <ProfileIntelligence
                settings={settings}
                tab={tab}
                onChanged={(next) => {
                  if (next) setDraft(next);
                  loaded.current = false;
                  void refresh();
                }}
              />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = CandidateProfileSchema.safeParse({
                  ...profile,
                  preferences: {
                    ...profile.preferences,
                    roles: list(rolesText),
                    excludedRoles: list(excludedText),
                    locations: list(locationsText),
                    preferredCompanies: list(preferredCompanies),
                    excludedCompanies: list(excludedCompanies),
                  },
                  version: (view?.profile?.version ?? 0) + 1,
                });
                if (parsed.success) void command({ op: 'saveProfile', profile: parsed.data });
                else setError('Check profile fields, provenance and weights (must sum to 1).');
              }}
            >
              <div hidden={profileSection !== 'skills'}>
                <SkillsPanel
                  profile={profile}
                  onUpdate={setProfile}
                  onAdd={() => {
                    setField('skill');
                    setShowAddSkill(true);
                  }}
                />
              </div>
              {(['experience', 'education', 'projects'] as const).map((section) => (
                <div hidden={profileSection !== section} key={section}>
                  <h2>{section[0]!.toUpperCase() + section.slice(1)}</h2>
                  <ProfileQualifications
                    profile={profile}
                    section={section}
                    onUpdate={setProfile}
                  />
                  {section === 'education' && (
                    <>
                      <h3>Certifications</h3>
                      <ProfileQualifications
                        profile={profile}
                        section="certifications"
                        onUpdate={setProfile}
                      />
                    </>
                  )}
                </div>
              ))}
              <LegacyFacts
                key={profileSection}
                profile={profile}
                fields={
                  profileSection === 'skills'
                    ? []
                    : [
                        ...new Set(
                          profile.facts
                            .filter((f) => factSection(f.field) === profileSection)
                            .map((f) => f.field),
                        ),
                      ]
                }
                onUpdate={setProfile}
              />
              <div hidden={profileSection !== 'preferences'}>
                <h2>Preferences</h2>
                <p className="help-text">
                  Soft preferences influence fit and search; explicit legal restrictions and
                  eligibility remain separate.
                </p>
                <div className="career-fields">
                  <label>
                    Preferred roles
                    <input value={rolesText} onChange={(e) => setRolesText(e.target.value)} />
                  </label>
                  <label>
                    Excluded roles
                    <input value={excludedText} onChange={(e) => setExcludedText(e.target.value)} />
                  </label>
                  <label>
                    Preferred locations
                    <input
                      value={locationsText}
                      onChange={(e) => setLocationsText(e.target.value)}
                    />
                  </label>
                  <label>
                    Preferred companies
                    <input
                      value={preferredCompanies}
                      onChange={(e) => setPreferredCompanies(e.target.value)}
                    />
                  </label>
                  <label>
                    Excluded companies
                    <input
                      value={excludedCompanies}
                      onChange={(e) => setExcludedCompanies(e.target.value)}
                    />
                  </label>
                  <label>
                    Minimum annual salary
                    <input
                      type="number"
                      min="0"
                      value={profile.preferences.minimumSalary ?? ''}
                      onChange={(e) =>
                        preferences({
                          minimumSalary: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Salary currency
                    <input
                      maxLength={3}
                      value={profile.preferences.currency}
                      onChange={(e) => preferences({ currency: e.target.value.toUpperCase() })}
                    />
                  </label>
                </div>
                <fieldset>
                  <legend>Allowed work modes (none means unrestricted)</legend>
                  {(['remote', 'hybrid', 'onsite'] as const).map((mode) => (
                    <label key={mode}>
                      <input
                        type="checkbox"
                        checked={profile.preferences.workModes.includes(mode)}
                        onChange={(e) =>
                          preferences({
                            workModes: e.target.checked
                              ? [...profile.preferences.workModes, mode]
                              : profile.preferences.workModes.filter((m) => m !== mode),
                          })
                        }
                      />
                      {mode}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Allowed levels (none means unrestricted)</legend>
                  {(['internship', 'new-grad', 'junior', 'mid', 'senior'] as const).map((level) => (
                    <label key={level}>
                      <input
                        type="checkbox"
                        checked={profile.preferences.levels.includes(level)}
                        onChange={(e) =>
                          preferences({
                            levels: e.target.checked
                              ? [...profile.preferences.levels, level]
                              : profile.preferences.levels.filter((l) => l !== level),
                          })
                        }
                      />
                      {level}
                    </label>
                  ))}
                </fieldset>
                <p className="help-text">
                  Select or customize ranking configurations from Jobs. Legacy v1 preserves the
                  original weights.
                </p>
              </div>
              <button disabled={busy} type="submit">
                Save candidate profile
              </button>
            </form>
            <button
              type="button"
              className="text-action"
              hidden={['imports', 'preferences', 'skills'].includes(profileSection)}
              onClick={() => {
                setField(
                  profileSection === 'experience'
                    ? 'experience'
                    : profileSection === 'education'
                      ? 'education'
                      : profileSection === 'projects'
                        ? 'project'
                        : 'name',
                );
                setShowAddSkill(true);
              }}
            >
              + Add{' '}
              {profileSection === 'experience'
                ? 'experience'
                : profileSection === 'education'
                  ? 'education'
                  : profileSection === 'projects'
                    ? 'a project'
                    : 'other information'}
            </button>
            {showAddSkill && (
              <QualificationComposer
                profile={profile}
                initial={
                  field === 'skill'
                    ? 'skills'
                    : field === 'project'
                      ? 'projects'
                      : field === 'education'
                        ? 'education'
                        : field === 'experience'
                          ? 'experience'
                          : 'other'
                }
                onClose={() => setShowAddSkill(false)}
                onSave={(next, section) => {
                  setProfile(next);
                  setProfileSection(
                    section === 'other'
                      ? 'identity'
                      : section === 'certifications'
                        ? 'education'
                        : section,
                  );
                }}
              />
            )}
            <details hidden={profileSection !== 'imports'}>
              <summary>Import proposed facts as JSON</summary>
              <p>
                Use an array of facts with id, field, value, verified, and source (kind, reference,
                capturedAt). Legal assertions require source kind user. All imported facts become
                unverified.
              </p>
              <textarea
                aria-label="Proposed facts JSON"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button
                disabled={busy || !view?.profile}
                onClick={() => {
                  try {
                    const raw: unknown = JSON.parse(importText);
                    if (!Array.isArray(raw)) throw new Error();
                    const facts = raw.map((f: unknown) => ProfileFactSchema.parse(f));
                    void command({ op: 'proposeFacts', facts });
                  } catch {
                    setError('Invalid proposed facts JSON');
                  }
                }}
              >
                Import proposals
              </button>
            </details>
          </>
        ) : (
          <>
            <h1>Jobs</h1>
            <p className="help-text">
              Search your job index while Rovdo discovers new opportunities.
            </p>
            <nav className="section-nav jobs-tabs" aria-label="Jobs views">
              {(
                [
                  ['results', 'Find Jobs'],
                  ['saved', `Saved Jobs (${view?.savedIds.length ?? 0})`],
                  ['sources', 'Sources & Coverage'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} aria-pressed={jobView === id} onClick={() => selectJobView(id)}>
                  {label}
                </button>
              ))}
            </nav>
            <div hidden={jobView === 'sources'}>
              {jobView === 'saved' && <h2>Saved jobs</h2>}
              <section hidden={jobView !== 'results'} className="job-search" aria-label="Find jobs">
                <form
                  className="job-filters simplified-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = { ...search, offset: 0 };
                    searchRef.current = next;
                    setSearch(next);
                    // Refresh cached matches immediately; collection never clears the visible list.
                    void refresh().catch(() => setError('Search failed. Try again.'));
                    if (searchScope === 'global')
                      void command({
                        op: 'startDiscovery',
                        options: discoveryOptionsForSearch(next, defaultDiscovery),
                        consent: true,
                      });
                    else if (searchScope === 'company' && search.selectedSourceId)
                      void command({ op: 'pollCompany', id: search.selectedSourceId });
                    else if (searchScope === 'saved-companies')
                      void command({ op: 'searchSavedCompanies' });
                  }}
                >
                  <div className="search-primary-row">
                    <label>
                      Search jobs
                      <input
                        placeholder="Job title, keyword, or company"
                        value={search.query}
                        onChange={(e) => setSearch({ ...search, query: e.target.value, offset: 0 })}
                      />
                    </label>
                    <label>
                      Location
                      <input
                        placeholder="Anywhere"
                        value={search.location ?? ''}
                        onChange={(e) =>
                          setSearch({ ...search, location: e.target.value, offset: 0 })
                        }
                      />
                    </label>
                    <label>
                      Job type
                      <select
                        value={search.employmentType ?? 'all'}
                        onChange={(e) =>
                          setSearch({
                            ...search,
                            employmentType: e.target.value as JobSearch['employmentType'],
                            offset: 0,
                          })
                        }
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
                          <option key={v} value={v}>
                            {v === 'all' ? 'All types' : v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={
                        busy ||
                        (searchScope === 'company' && !search.selectedSourceId) ||
                        !!view?.polling ||
                        view?.discovery?.run?.status === 'running' ||
                        (searchScope === 'global' &&
                          !(search.discovery ?? defaultDiscovery).sourceIds.length)
                      }
                    >
                      Find Jobs
                    </button>
                  </div>
                  <div className="search-secondary-row">
                    <AdvancedFilters
                      search={search}
                      setSearch={setSearch}
                      sources={view?.discovery?.registry ?? []}
                    />
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => setRankingOpen(!rankingOpen)}
                      aria-expanded={rankingOpen}
                    >
                      Ranking &amp; matching
                    </button>
                    <span className="help-text">
                      Cached results update automatically.{' '}
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => selectJobView('sources')}
                      >
                        Manage sources
                      </button>
                    </span>
                  </div>
                </form>
              </section>
              {jobView === 'results' && (
                <CollectionActivity
                  view={view?.discovery}
                  command={command}
                  busy={busy}
                  onHealth={showCollectionHealth}
                />
              )}
              {jobView === 'results' && view?.polling && (
                <p role="status">Checking saved employer feeds. Cached results remain available.</p>
              )}
              <section hidden={!rankingOpen} aria-label="Ranking workspace">
                {'      '}
                <ProfileIntelligence
                  settings={settings}
                  onSelected={setPreviewRankingId}
                  tab={tab}
                  onChanged={(next) => {
                    if (next) setDraft(next);
                    loaded.current = false;
                    void refresh();
                  }}
                />
                <section className="surface-card">
                  <h2>Preview saved ranking</h2>
                  <p className="help-text">
                    Compare the selected saved configuration against a real indexed job. Unsaved
                    edits are not used; save the configuration first.
                  </p>
                  {!view?.matches.length && (
                    <p className="help-text">
                      Search for jobs or reset filters in Find Jobs before previewing a saved
                      configuration.
                    </p>
                  )}
                  <label>
                    Preview job
                    <select
                      value={previewJobId || view?.matches[0]?.job.id || ''}
                      onChange={(e) => setPreviewJobId(e.target.value)}
                    >
                      {view?.matches.map((m) => (
                        <option key={m.job.id} value={m.job.id}>
                          {m.job.company} / {m.job.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={busy || !view?.matches.length}
                    onClick={() =>
                      void command({
                        op: 'compare',
                        jobId: previewJobId || view!.matches[0]!.job.id,
                        rankingIds: [
                          previewRankingId,
                          previewRankingId === 'builtin:legacy-v1'
                            ? 'builtin:technical-balanced'
                            : 'builtin:legacy-v1',
                        ],
                      })
                    }
                  >
                    Preview saved scores
                  </button>
                  {!!view?.comparisons.length && (
                    <div className="ranking-preview-results">
                      {view.comparisons.map((m) => (
                        <p key={m.ranking?.configId}>
                          {view.rankingProfiles.find((p) => p.id === m.ranking?.configId)?.name}
                          {': '}
                          {m.score.toFixed(1)} / 100; confidence {Math.round(m.confidence * 100)}%;
                          coverage {Math.round((m.ranking?.requiredCoverage ?? 0) * 100)}%
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              </section>
              <div className="job-results-toolbar">
                <strong>
                  {view?.matchedCount ?? 0} {jobView === 'saved' ? 'saved jobs' : 'matching jobs'}
                </strong>
                {jobView === 'saved' && (
                  <AdvancedFilters
                    search={search}
                    setSearch={setSearch}
                    sources={view?.discovery?.registry ?? []}
                  />
                )}
                <label>
                  Sort results
                  <select
                    value={search.sort ?? 'qualification'}
                    onChange={(e) =>
                      void applySearch({
                        ...search,
                        sort: e.target.value as JobSearch['sort'],
                        offset: 0,
                      })
                    }
                  >
                    {['qualification', 'newest', 'salary', 'company'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
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
              {search.eligibility === 'fail' && !search.includeExcluded && (
                <div role="alert">
                  <p>Explicit failure requires Show excluded jobs.</p>
                  <button
                    type="button"
                    onClick={() =>
                      void applySearch({ ...search, includeExcluded: true, offset: 0 })
                    }
                  >
                    Show excluded jobs
                  </button>
                </div>
              )}
              {exportStatus && <p role="status">{exportStatus}</p>}
              {!!view?.rankingPending && (
                <p role="status">
                  Preparing deterministic scores for {view.rankingPending} remaining jobs. Results
                  appear in bounded batches.
                </p>
              )}
              <details className="comparison-control">
                <summary>Compare ranking methods</summary>
                <label>
                  Comparison method
                  <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                    {view?.rankingProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
              {!!view?.comparisons.length && (
                <section className="status-card" aria-label="Ranking comparison">
                  <h2>Ranking comparison</h2>
                  <p>
                    Same job and verified evidence. Scores from different methods measure different
                    kinds of fit; these are not probabilities.
                  </p>
                  <table className="ranking-breakdown">
                    <thead>
                      <tr>
                        <th>Configuration</th>
                        <th>Score</th>
                        <th>Confidence</th>
                        <th>Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.comparisons.map((m) => (
                        <tr key={m.ranking?.configId}>
                          <td>
                            {view.rankingProfiles.find((p) => p.id === m.ranking?.configId)?.name} v
                            {m.ranking?.configRevision}
                          </td>
                          <td>{m.score.toFixed(1)}</td>
                          <td>{Math.round(m.confidence * 100)}%</td>
                          <td>{Math.round((m.ranking?.requiredCoverage ?? 0) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              <p role="status">
                {view?.outcome.replaceAll('_', ' ')} · {view?.matchedCount ?? 0}
                {' matches / '}
                {view?.totalJobs ?? 0} indexed jobs {view?.polling ? '· Polling sources' : ''}
              </p>

              {view && !view.matches.length && (
                <section className="surface-card empty-results" aria-label="Search diagnostics">
                  <h2>
                    {jobView === 'saved'
                      ? 'No saved jobs match'
                      : view.totalJobs
                        ? 'No matching jobs'
                        : view.polling
                          ? 'Collecting jobs'
                          : 'No jobs indexed yet'}
                  </h2>
                  <p>
                    {jobView === 'saved'
                      ? 'Save opportunities from Find Jobs to keep them here. Your current filters also apply to this list.'
                      : view.totalJobs
                        ? `${view.totalJobs} jobs are indexed, but none match the current query, filters and eligibility visibility.`
                        : 'Start Search All to discover public feeds and employers, or choose Search All Saved Companies for the approved directory. Inspect coverage for incomplete or blocked sources.'}
                  </p>
                  {search.savedOnly && <p>This search is restricted to saved opportunities.</p>}
                  {!view.profile && (
                    <p>
                      No candidate profile is saved. Verify your qualifications in Profile to
                      improve matching.
                    </p>
                  )}
                  <p>
                    {view.sources.filter((s) => s.state.status === 'FAILED_SOURCE').length} failed
                    sources / {view.sources.filter((s) => s.config.enabled).length} enabled. Unknown
                    eligibility remains reviewable.
                  </p>
                  <div className="button-row">
                    <button onClick={resetFilters}>Reset filters</button>
                    <button onClick={() => selectJobView('sources')}>Review source coverage</button>
                  </div>
                </section>
              )}
              <div className="job-list">
                {view?.matches.map((m) => (
                  <JobCard
                    key={m.job.id}
                    match={m}
                    saved={view.savedIds.includes(m.job.id)}
                    marker={view.markers.find((x) => x.jobId === m.job.id)}
                    rankings={view.rankingProfiles}
                    reviews={view.reviews}
                    compareId={compareId}
                    command={command}
                    busy={busy}
                    onReview={() => {
                      setReviewId(m.job.id);
                      setConsent(false);
                    }}
                  />
                ))}
              </div>
              <div className="button-row">
                <button
                  disabled={(search.offset ?? 0) === 0}
                  onClick={() => {
                    searchRef.current = {
                      ...search,
                      offset: Math.max(0, (search.offset ?? 0) - 50),
                    };
                    setSearch(searchRef.current);
                  }}
                >
                  Previous 50
                </button>
                <button
                  disabled={(search.offset ?? 0) + 50 >= (view?.matchedCount ?? 0)}
                  onClick={() => {
                    searchRef.current = { ...search, offset: (search.offset ?? 0) + 50 };
                    setSearch(searchRef.current);
                  }}
                >
                  Next 50
                </button>
              </div>
              {outbound && (
                <section className="status-card">
                  <h2>Review outbound shortlist</h2>
                  <label>
                    Review model
                    <select
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setConsent(false);
                      }}
                    >
                      <option value="">Select a model</option>
                      {settings.profiles.map((p) => (
                        <option key={p.config.id} value={p.config.id}>
                          {p.config.label} · {p.config.model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Destination: {selectedModel?.baseUrl ?? 'choose a model'} · estimated spend cap
                    $0.10 · one saved job.
                  </p>
                  <details>
                    <summary>Exact outbound content</summary>
                    <pre>{JSON.stringify(outbound, null, 2)}</pre>
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I approve sharing this payload with this model
                  </label>
                  <button
                    disabled={busy || !model || !consent || !reviewHash || reviewMatch?.excluded}
                    onClick={() =>
                      void command({
                        op: 'evaluate',
                        jobIds: [reviewId],
                        modelProfileId: model,
                        ...(reviewRanking ? { rankingId: reviewRanking.id } : {}),
                        ...(reviewAsOf ? { asOf: reviewAsOf } : {}),
                        payloadHash: reviewHash,
                        query: search.query,
                        maxUsd: 0.1,
                        consent: true,
                      })
                    }
                  >
                    Evaluate saved job
                  </button>
                </section>
              )}
              <DiscoveryControls
                mode="saved"
                view={view}
                search={search}
                command={command}
                busy={busy}
                loadSearch={(s) => {
                  setJobView(s.savedOnly ? 'saved' : 'results');
                  void applySearch({ ...s, scope: s.scope ?? 'saved-companies' });
                }}
              />
            </div>
            <section hidden={jobView !== 'sources'} aria-label="Source workspace">
              <h2>Where Rovdo collects jobs</h2>
              <p className="help-text">
                These settings control future collection. They do not change filters on jobs already
                in your index. Removing a source preserves collected jobs and saved opportunities.
              </p>
              <div className="career-fields collection-settings">
                <label>
                  Search scope
                  <select
                    aria-label="Search scope"
                    value={searchScope}
                    onChange={(e) =>
                      setSearch({
                        ...search,
                        scope: e.target.value as JobSearch['scope'],
                        selectedSourceId: undefined,
                        offset: 0,
                      })
                    }
                  >
                    <option value="global">Search All</option>
                    <option value="saved-companies">Search All Saved Companies</option>
                    <option value="company">Selected company</option>
                  </select>
                </label>
                {searchScope === 'company' && (
                  <label>
                    Selected employer
                    <select
                      aria-label="Selected employer"
                      value={search.selectedSourceId ?? ''}
                      onChange={(e) =>
                        setSearch({
                          ...search,
                          selectedSourceId: e.target.value || undefined,
                          offset: 0,
                        })
                      }
                    >
                      <option value="">Choose a saved company</option>
                      {view?.sources.map((s) => (
                        <option key={s.config.id} value={s.config.id}>
                          {s.config.company}
                          {s.config.enabled ? '' : ' (disabled)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <GlobalDiscovery
                view={view?.discovery}
                criteria={search}
                options={search.discovery ?? defaultDiscovery}
                onOptions={(options) => setSearch({ ...search, discovery: options })}
                command={command}
                busy={busy}
              />
              <p className="help-text">
                {view?.directory.length ?? 0} directory sources /{' '}
                {view?.sources.filter((s) => s.config.enabled).length ?? 0} enabled saved employers
                / {view?.sources.filter((s) => s.state.status === 'FAILED_SOURCE').length ?? 0}{' '}
                failed saved sources.
              </p>
              <details className="source-registry">
                <summary>Source health</summary>
                <p className="help-text">
                  Removing a source stops polling. Collected jobs, saved opportunities and
                  provenance are kept.
                </p>
                {view?.sources.map((s) => (
                  <article className="status-card source-card" key={s.config.id}>
                    <button
                      className="source-remove"
                      aria-label={`Delete source ${s.config.company}`}
                      title={`Delete source ${s.config.company}`}
                      disabled={busy}
                      onClick={() => void command({ op: 'deleteSource', id: s.config.id })}
                    >
                      &#215;
                    </button>
                    <h3>
                      {s.config.company} · {s.config.ats}/{s.config.tenant}
                    </h3>
                    <p>
                      {s.state.status} · HTTP {s.state.responseStatus ?? '—'} · {s.state.requests}
                      {' requests · '}
                      {s.state.parsed} parsed · {s.state.rejected}
                      {' rejected · '}
                      {s.state.duplicates} duplicates · {s.state.accepted} new
                    </p>
                    <p>
                      {'Last success '}
                      {s.state.lastSuccessAt
                        ? new Date(s.state.lastSuccessAt).toLocaleString()
                        : 'never'}
                      {' · next poll '}
                      {new Date(s.state.nextPollAt).toLocaleString()}
                      {' · '}
                      {s.state.failures} consecutive failures
                    </p>
                    <p>{s.state.error}</p>
                    <label>
                      Poll interval in minutes
                      <input
                        type="number"
                        min="1"
                        defaultValue={s.config.intervalMs / 60000}
                        onBlur={(e) => {
                          if (Number(e.target.value) * 60000 !== s.config.intervalMs)
                            void command({
                              op: 'saveSource',
                              source: { ...s.config, intervalMs: Number(e.target.value) * 60000 },
                            });
                        }}
                      />
                    </label>
                    <button
                      onClick={() =>
                        void command({
                          op: 'saveSource',
                          source: { ...s.config, enabled: !s.config.enabled },
                        })
                      }
                    >
                      {s.config.enabled ? 'Disable source' : 'Enable source'}
                    </button>
                  </article>
                ))}
              </details>

              <details>
                <summary>Advanced Source Management</summary>
                <p>
                  Manual company identifiers are optional. Normal discovery uses the verified
                  directory.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command({
                      op: 'saveSource',
                      source: {
                        id: crypto.randomUUID(),
                        ats,
                        tenant,
                        company,
                        enabled: true,
                        region,
                        intervalMs: interval * 60000,
                        termsReviewedAt: new Date().toISOString(),
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        priority: 0,
                        missingGracePolls: 3,
                      },
                    });
                  }}
                >
                  <label>
                    ATS
                    <select
                      value={ats}
                      onChange={(e) => setAts(e.target.value as SourceConfig['ats'])}
                    >
                      {['greenhouse', 'lever', 'ashby', 'smartrecruiters'].map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Employer name
                    <input required value={company} onChange={(e) => setCompany(e.target.value)} />
                  </label>
                  <label>
                    Public board / tenant identifier
                    <input
                      required
                      pattern="[a-zA-Z0-9_-]+"
                      value={tenant}
                      onChange={(e) => setTenant(e.target.value)}
                    />
                  </label>
                  <label>
                    Lever region
                    <select
                      value={region}
                      onChange={(e) => setRegion(e.target.value as SourceConfig['region'])}
                    >
                      <option value="global">Global</option>
                      <option value="eu">EU</option>
                    </select>
                  </label>
                  <label>
                    Polling interval (minutes)
                    <input
                      type="number"
                      min="1"
                      max="43200"
                      value={interval}
                      onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={terms}
                      onChange={(e) => setTerms(e.target.checked)}
                    />
                    I reviewed this source's access terms and permit read-only polling
                  </label>
                  <button disabled={!terms || busy} type="submit">
                    Add source
                  </button>
                </form>
              </details>
              <DiscoveryControls
                mode="sources"
                view={view}
                search={search}
                command={command}
                busy={busy}
                loadSearch={(s) => {
                  setJobView(s.savedOnly ? 'saved' : 'results');
                  void applySearch({ ...s, scope: s.scope ?? 'saved-companies' });
                }}
              />
            </section>
          </>
        )}
      </fieldset>
    </div>
  );
}
