import { useEffect, useState } from 'react';
import type { BrowserRecord, CareerViewSchema, SettingsView } from '@rovdo/shared';
import type { z } from 'zod';
import { formatUsd } from './presentation';
import type { WorkspacePage } from './presentation';
import lightMark from './assets/logo_nosub.png';
import darkMark from './assets/inverted_logo_nosub.png';

type View = z.infer<typeof CareerViewSchema>;
export function Dashboard({ active, settings, navigate, settingsAvailable = true, theme = 'light' }: { settingsAvailable?: boolean | null; theme?: 'light' | 'dark'; active: boolean; settings: SettingsView; navigate: (page: WorkspacePage, savedOnly?: boolean) => void }) {
  const [career, setCareer] = useState<View | null>(null); const [runs, setRuns] = useState<BrowserRecord[] | null>(null);
  const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active) return; let current = true;
    async function load() {
      const results = await Promise.allSettled([
        window.rovdo!.careerCommand({ op: 'view', search: { query: '', company: '', workMode: 'all', savedOnly: false, includeExcluded: false, offset: 0 } }),
        window.rovdo!.browserCommand({ op: 'list' }),
      ]);
      if (!current) return;
      const [jobs, browser] = results;
      if (jobs.status === 'fulfilled' && jobs.value.ok) setCareer(jobs.value.view);
      if (browser.status === 'fulfilled' && browser.value.ok) setRuns(browser.value.runs);
      setError(results.some((r) => r.status === 'rejected' || !r.value.ok) ? 'Some workspace data is unavailable. Refresh to try again.' : '');
    }
    void load().catch(() => { if (current) setError('Workspace data unavailable.'); });
    const timer = setInterval(() => { void load().catch(() => {}); }, 15000);
    return () => { current = false; clearInterval(timer); };
  }, [active, reload]);
  const activities = [
    ...(career?.sources.filter((s) => s.state.lastSuccessAt !== null).map((s) => ({ id: s.config.id, at: s.state.lastSuccessAt!, text: `${s.config.company}: successful collection`, page: 'jobs' as const })) ?? []),
    ...(runs?.map((r) => ({ id: r.id, at: r.createdAt, text: `Browser: ${r.request.task} (${r.state.toLowerCase()})`, page: 'browser' as const })) ?? []),
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 5);
  const readyModels = settings.profiles.filter((p) => ['stored', 'not-required'].includes(p.credential) && p.config.capabilities?.streaming === 'supported' && p.config.capabilities.tools === 'supported' && p.config.pricing);
  return <div className="dashboard">
    <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Workspace overview</h1><p className="intro">Pick up your work. Your profile stays local.</p></div><img className="panel-symbol" src={theme === 'dark' ? darkMark : lightMark} width="64" height="64" alt="" /></div>
    {error && <p role="alert">{error}</p>}{!career && !error && <p role="status">Loading workspace...</p>}
    <section className="dashboard-stats" aria-label="Job statistics">
      <article className="metric-card"><span>Indexed jobs</span><strong data-testid="dashboard-indexed">{career ? career.totalJobs.toLocaleString() : '—'}</strong><button onClick={() => navigate('jobs')}>Find opportunities</button></article>
      <article className="metric-card"><span>Saved opportunities</span><strong>{career ? career.savedIds.length.toLocaleString() : '—'}</strong><button onClick={() => navigate('jobs', true)}>Review saved opportunities</button></article>
      <article className="metric-card"><span>Enabled sources</span><strong>{career ? career.sources.filter((s) => s.config.enabled).length : '—'}</strong><p>{career ? `${career.sources.filter((s) => s.state.status === 'FAILED_SOURCE').length} need attention` : 'Waiting for source status'}</p></article>
      <article className="metric-card"><span>Model connection</span><strong className="metric-description">{settingsAvailable === null ? 'Loading models...' : !settingsAvailable ? 'Model status unavailable' : !settings.profiles.length ? 'No model connected' : `${readyModels.length} ready for chat`}</strong><button onClick={() => navigate('models')}>{settings.profiles.length ? 'Manage models' : 'Set up a model'}</button></article>
    </section>
    <div className="dashboard-columns"><section className="surface-card"><div className="section-heading"><h2>Recent activity</h2><button onClick={() => setReload((n) => n + 1)}>Refresh overview</button></div>{activities.length ? <ul className="activity-list">{activities.map((a) => <li key={a.id}><button onClick={() => navigate(a.page)}>{a.text}</button><time dateTime={new Date(a.at).toISOString()}>{new Date(a.at).toLocaleString()}</time></li>)}</ul> : <p className="empty-state">{career && runs ? 'No collection or browser activity yet. Start with job discovery or a scoped browser task.' : 'Waiting for recorded activity.'}</p>}</section>
    <section className="surface-card"><h2>Quick actions</h2><div className="quick-actions"><button onClick={() => navigate('profile')}>Review candidate profile</button><button onClick={() => navigate('chat')}>Open chat</button><button onClick={() => navigate('browser')}>Start a browser task</button></div><h3>API usage</h3>{settingsAvailable ? <><p>{(settings.usage.inputTokens + settings.usage.outputTokens).toLocaleString()} reported tokens / {settings.usage.requests} requests</p><p>Estimated spend {formatUsd(settings.usage.estimatedUsd)}{settings.usage.unpricedRequests ? ` / ${settings.usage.unpricedRequests} unpriced requests` : ''}</p></> : <p role="status">{settingsAvailable === null ? 'Loading usage...' : 'Usage unavailable'}</p>}<small>Estimates use your configured rates. Model requests require your consent.</small></section></div>
  </div>;
}
