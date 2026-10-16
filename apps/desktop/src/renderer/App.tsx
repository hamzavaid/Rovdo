import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '@rovdo/shared';
import logo from './assets/rovdo_logo.png';
import invertedMark from './assets/inverted_logo_nosub.png';
import { Chat } from './Chat';
import { Models } from './Models';
import { BrowserRun } from './BrowserRun';
import { CareerWorkspace } from './CareerWorkspace';

export function App() {
  const [connection, setConnection] = useState('Connecting to desktop');
  const [view, setView] = useState<'overview' | 'chat' | 'models' | 'browser' | 'jobs' | 'profile'>('overview');
  const [settings, setSettings] = useState<SettingsView>({ profiles: [], usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, requests: 0, unpricedRequests: 0 } });
  const refresh = useCallback(async () => {
    try {
      const result = await window.rovdo?.getSettings();
      if (result?.ok) setSettings(result.settings);
      else setConnection('Settings unavailable');
    } catch { setConnection('Settings unavailable'); }
  }, []);
  useEffect(() => {
    let active = true;
    const bridge = window.rovdo;
    if (!bridge) {
      setConnection('Desktop unavailable');
      return;
    }
    void bridge.getAppInfo().then(
      () => { if (active) setConnection('Desktop connected'); },
      () => { if (active) setConnection('Desktop unavailable'); },
    );
    void refresh();
    return () => { active = false; };
  }, [refresh]);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace">
        <div className="brand"><img src={logo} alt="Rovdo" width="96" height="96" /></div>
        <p className="sidebar-label">YOUR WORKSPACE</p>
        <nav className="workspace-nav" aria-label="Main navigation">
          <button type="button" className={view === 'overview' ? 'workspace-item active' : 'workspace-item'} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => setView('overview')}>Overview</button>
          <button type="button" className={view === 'chat' ? 'workspace-item active' : 'workspace-item'} aria-current={view === 'chat' ? 'page' : undefined} onClick={() => setView('chat')}>Chat</button>
          <button type="button" className={view === 'browser' ? 'workspace-item active' : 'workspace-item'} aria-current={view === 'browser' ? 'page' : undefined} onClick={() => setView('browser')}>Browser</button>
          <button type="button" className={view === 'jobs' ? 'workspace-item active' : 'workspace-item'} aria-current={view === 'jobs' ? 'page' : undefined} onClick={() => setView('jobs')}>Jobs</button>
          <button type="button" className={view === 'profile' ? 'workspace-item active' : 'workspace-item'} aria-current={view === 'profile' ? 'page' : undefined} onClick={() => setView('profile')}>Profile</button>
          <button type="button" className={view === 'models' ? 'workspace-item active' : 'workspace-item'} aria-current={view === 'models' ? 'page' : undefined} onClick={() => setView('models')}>Models &amp; Privacy</button>
        </nav>
        <div className="sidebar-footer"><span className="status-dot" />Local-first by design</div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><span>{{ overview: 'Workspace overview', chat: 'Chat workspace', models: 'Model settings', browser: 'Browser workspace', jobs: 'Job discovery', profile: 'Candidate profile' }[view]}</span><span className="preview-badge">Browser + Jobs</span></header>
        <main>
          <section hidden={view !== 'overview'}>
          <div className="eyebrow">A CONSIDERED START</div>
          <h1>Your workspace starts here.</h1>
          <p className="intro">A home for your work, with you in control. Rovdo is building a local-first workspace for thoughtful AI automation.</p>

          <section className="welcome-panel" aria-labelledby="foundation-title">
            <img className="panel-symbol" src={invertedMark} alt="" width="112" height="112" />
            <div>
              <div className="eyebrow">PROJECT STATUS</div>
              <h2 id="foundation-title">Your desktop is ready.</h2>
              <p>Discover jobs without AI, verify your candidate profile, or run a scoped browser task with your model. Your keys stay in the OS vault. Browser interactions require your approval.</p>
            </div>
          </section>

          <section className="status-grid" aria-label="Workspace status">
            <article className="status-card"><span className="card-label">MODELS</span><h2>{settings.profiles.length ? `${settings.profiles.length} model profiles` : 'No model connected'}</h2><p>Add and test providers in Models &amp; Privacy.</p></article>
            <article className="status-card"><span className="card-label">PRIVACY</span><h2>{settings.profiles.length ? 'You control what is shared' : 'Your profile stays local'}</h2><p>Model requests require your explicit consent.</p></article>
            <article className="status-card"><span className="card-label">USAGE</span><h2>{settings.usage.inputTokens + settings.usage.outputTokens} reported tokens</h2><p>{settings.usage.requests} API requests · estimated ${settings.usage.estimatedUsd.toFixed(6)}{settings.usage.unpricedRequests ? ` · ${settings.usage.unpricedRequests} unpriced calls` : ''}</p></article>
          </section>
          </section>
          <section hidden={view !== 'chat'}><Chat settings={settings} refresh={refresh} /></section>
          <section hidden={view !== 'models'}><Models settings={settings} refresh={refresh} /></section>
          <section hidden={view !== 'browser'}><BrowserRun settings={settings} /></section>
          {(view === 'jobs' || view === 'profile') && <CareerWorkspace tab={view} settings={settings} />}
          <footer className="workspace-footer"><span role="status"><span className="status-dot" />{connection}</span><span>Your device. Your models. Your decisions.</span></footer>
        </main>
      </div>
    </div>
  );
}
