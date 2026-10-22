/** Local opt-in for optional Python collection; settings never grant permission to restricted websites. */
import { useEffect, useState } from 'react';
import { useActionState } from './action-state';
import { OperationStatus } from './OperationStatus';
export function DiscoverySettings() {
  const [enabled, setEnabled] = useState(false),
    [accepted, setAccepted] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const { pending, label, run } = useActionState();
  useEffect(() => {
    let active = true;
    void window.rovdo
      ?.careerCommand({
        op: 'view',
        summary: true,
        search: {
          query: '',
          company: '',
          workMode: 'all',
          savedOnly: false,
          includeExcluded: false,
        },
      })
      .then(
        (r) => {
          if (!active) return;
          if (r.ok) {
            setEnabled(r.view.jobspy?.enabled ?? false);
            setAccepted(r.view.jobspy?.riskAccepted ?? false);
            setLoaded(true);
          } else setError('Discovery settings could not be loaded. Reopen this page to retry.');
        },
        () => {
          if (active) setError('Desktop connection unavailable. Reopen this page to retry.');
        },
      );
    return () => {
      active = false;
    };
  }, []);
  async function save(next: boolean) {
    await run('Saving discovery settings...', async () => {
      setError('');
      try {
        const r = await window.rovdo?.careerCommand({
          op: 'jobspySettings',
          settings: { enabled: next, riskAccepted: accepted },
        });
        if (r?.ok) setEnabled(next);
        else setError('Settings were not saved. Review the acknowledgment and try again.');
      } catch {
        setError('Desktop connection unavailable. Your previous settings are unchanged.');
      }
    });
  }
  return (
    <section className="settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Discovery & imports</h1>
          <p>Choose how optional sources collect public job listings.</p>
        </div>
      </header>
      <section className="surface-card">
        <h2>Optional JobSpy scraping</h2>
        <p>
          Off by default. This experimental integration uses a separate Python process. Scraping may
          be blocked, break when websites change, or be restricted by a provider's terms. Enable it
          at your own risk and only for sources you are permitted to access.
        </p>
        <p>
          Rovdo checks robots rules, keeps TLS verification enabled, and stops at redirects,
          authentication, CAPTCHA and access challenges. It uses no browser impersonation, cookies
          or proxies. A website listed in the catalog is not a guarantee of working collection.
        </p>
        <label>
          <input
            type="checkbox"
            checked={accepted}
            disabled={!loaded || pending || enabled}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          I understand the risks and will only select sources whose policies permit collection
        </label>
        <div className="button-row">
          <button
            type="button"
            disabled={!loaded || pending || (!enabled && !accepted)}
            onClick={() => void save(!enabled)}
          >
            {enabled ? 'Disable JobSpy scraping' : 'Enable JobSpy scraping'}
          </button>
          <span className="status-pill">
            {enabled ? 'Enabled for selected JobSpy sources' : 'Disabled'}
          </span>
        </div>
        <details>
          <summary>Python setup and collection limits</summary>
          <p>
            Install Python 3.10 or newer and <code>python-jobspy</code> in the environment used by
            the <code>python</code> executable on PATH. Rovdo does not install or download Python
            packages. The interpreter runs with isolated import settings; user-site packages and
            PYTHONPATH are ignored.
          </p>
          <pre>
            <code>python -m pip install python-jobspy</code>
          </pre>
          <p>
            In Jobs, choose Search All, open Sources, queries and collection settings, then select
            supported JobSpy sources. Qualification queries and optional source location filters
            guide collection. Missing dependencies, unsupported request methods, restrictions, or
            schema changes appear in Collection health. Other discovery adapters continue
            independently.
          </p>
        </details>
        <OperationStatus label={label} />
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="surface-card">
        <h2>Your LinkedIn profile</h2>
        <p>
          JobSpy collects job listings; it does not import personal profiles. Use Profile → Imports
          for your LinkedIn archive or pasted profile content. Rovdo does not scrape restricted
          LinkedIn profile pages.
        </p>
        <p>
          Academic transcripts can also be imported locally as PDF, DOCX, TXT, Markdown or CSV.
          Coursework stays unverified until you review it.
        </p>
      </section>
    </section>
  );
}
