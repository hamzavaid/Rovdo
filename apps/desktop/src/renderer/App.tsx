/**
 * Application shell, grouped navigation and shared settings/appearance state.
 * Feature components own their local workflows and call the preload API for privileged operations.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '@rovdo/shared';
import darkLogo from './assets/inverted_rovdo_logo.png';
import { Dashboard } from './Dashboard';
import { navigation } from './presentation';
import type { WorkspacePage } from './presentation';
import { useAppearance } from './appearance';
import type { Appearance } from '@rovdo/shared';
import logo from './assets/rovdo_logo.png';
import { Chat } from './Chat';
import { Models } from './Models';
import { BrowserRun } from './BrowserRun';
import { CareerWorkspace } from './CareerWorkspace';

export function App() {
  const { appearance, resolved, setAppearance, error: appearanceError } = useAppearance();
  const [connection, setConnection] = useState('Connecting to desktop');
  const [view, setView] = useState<WorkspacePage>('overview');
  const [settingsAvailable, setSettingsAvailable] = useState<boolean | null>(null);
  const [savedJobs, setSavedJobs] = useState(false);
  function navigate(page: WorkspacePage, savedOnly = false) {
    setSavedJobs(savedOnly);
    setView(page);
  }
  const [settings, setSettings] = useState<SettingsView>({
    profiles: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, requests: 0, unpricedRequests: 0 },
  });
  const refresh = useCallback(async () => {
    try {
      const result = await window.rovdo?.getSettings();
      if (result?.ok) {
        setSettings(result.settings);
        setSettingsAvailable(true);
      } else {
        setConnection('Settings unavailable');
        setSettingsAvailable(false);
      }
    } catch {
      setConnection('Settings unavailable');
      setSettingsAvailable(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const bridge = window.rovdo;
    if (!bridge) {
      setConnection('Desktop unavailable');
      return;
    }
    void bridge.getAppInfo().then(
      () => {
        if (active) setConnection('Desktop connected');
      },
      () => {
        if (active) setConnection('Desktop unavailable');
      },
    );
    void refresh();
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace">
        <div className="brand">
          <img src={resolved === 'dark' ? darkLogo : logo} alt="Rovdo" width="96" height="96" />
        </div>
        <nav className="workspace-nav" aria-label="Main navigation">
          {navigation.map((group) => (
            <div role="group" aria-label={group.label} key={group.label}>
              <p className="sidebar-label">{group.label}</p>
              {group.pages.map((page) => (
                <button
                  type="button"
                  key={page.id}
                  className={view === page.id ? 'workspace-item active' : 'workspace-item'}
                  aria-current={view === page.id ? 'page' : undefined}
                  onClick={() => navigate(page.id)}
                >
                  {page.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Local-first by design
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            {
              {
                overview: 'Workspace overview',
                chat: 'Chat workspace',
                models: 'Model settings',
                browser: 'Browser workspace',
                jobs: 'Job discovery',
                profile: 'Candidate profile',
              }[view]
            }
          </span>
          <div className="topbar-controls">
            <label className="appearance-control">
              Appearance
              <select
                aria-label="Appearance"
                value={appearance}
                onChange={(e) => void setAppearance(e.target.value as Appearance)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
            <span className="preview-badge">Browser + Jobs</span>
          </div>
        </header>
        <main id="main-content">
          {appearanceError && <p role="alert">{appearanceError}</p>}
          <section hidden={view !== 'overview'}>
            <Dashboard
              settingsAvailable={settingsAvailable}
              theme={resolved}
              active={view === 'overview'}
              settings={settings}
              navigate={navigate}
            />
          </section>
          <section hidden={view !== 'chat'}>
            <Chat settings={settings} refresh={refresh} onConfigure={() => setView('models')} />
          </section>
          <section hidden={view !== 'models'}>
            <Models settings={settings} refresh={refresh} />
          </section>
          <section hidden={view !== 'browser'}>
            <BrowserRun settings={settings} />
          </section>
          {(view === 'jobs' || view === 'profile') && (
            <CareerWorkspace initialSavedOnly={savedJobs} tab={view} settings={settings} />
          )}
          <footer className="workspace-footer">
            <span role="status">
              <span className="status-dot" />
              {connection}
            </span>
            <span>Your device. Your models. Your decisions.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
