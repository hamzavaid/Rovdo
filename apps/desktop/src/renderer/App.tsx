import { useEffect, useState } from 'react';
import logo from './assets/rovdo_logo.png';
import invertedMark from './assets/inverted_logo_nosub.png';

export function App() {
  const [connection, setConnection] = useState('Connecting to desktop');
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
    return () => { active = false; };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace">
        <div className="brand"><img src={logo} alt="Rovdo" width="96" height="96" /></div>
        <p className="sidebar-label">YOUR WORKSPACE</p>
        <div className="workspace-item" aria-current="page"><span aria-hidden="true">◈</span> Overview</div>
        <div className="sidebar-footer"><span className="status-dot" />Local-first by design</div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><span>Workspace overview</span><span className="preview-badge">Foundation preview</span></header>
        <main>
          <div className="eyebrow">A CONSIDERED START</div>
          <h1>Your workspace starts here.</h1>
          <p className="intro">A home for your work, with you in control. Rovdo is building a local-first workspace for thoughtful AI automation.</p>

          <section className="welcome-panel" aria-labelledby="foundation-title">
            <img className="panel-symbol" src={invertedMark} alt="" width="112" height="112" />
            <div>
              <div className="eyebrow">PROJECT STATUS</div>
              <h2 id="foundation-title">The foundation is in place.</h2>
              <p>The desktop shell is ready. Model connections and automation will arrive in later milestones.</p>
            </div>
          </section>

          <section className="status-grid" aria-label="Workspace status">
            <article className="status-card"><span className="card-label">CONNECTION</span><h2>No model connected</h2><p>Provider setup is the next milestone.</p></article>
            <article className="status-card"><span className="card-label">PRIVACY</span><h2>No data leaves your device</h2><p>This preview makes no external requests.</p></article>
            <article className="status-card"><span className="card-label">ACTIVITY</span><h2>No active tasks</h2><p>Automation is not enabled in this preview.</p></article>
          </section>

          <footer className="workspace-footer"><span role="status"><span className="status-dot" />{connection}</span><span>Your device. Your models. Your decisions.</span></footer>
        </main>
      </div>
    </div>
  );
}
