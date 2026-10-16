import { useEffect, useState } from 'react';
import type { BrowserCommand, BrowserRecord, RunEvent, SettingsView } from '@rovdo/shared';

export function BrowserRun({ settings }: { settings: SettingsView }) {
  const [runs, setRuns] = useState<BrowserRecord[]>([]); const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState('');
  const [task, setTask] = useState(''); const [url, setUrl] = useState(''); const [origins, setOrigins] = useState('');
  const [expected, setExpected] = useState(''); const [profile, setProfile] = useState(''); const [consent, setConsent] = useState(false);
  async function command(cmd: BrowserCommand) {
    setBusy(true);
    try { const result = await window.rovdo!.browserCommand(cmd); if (result.ok) { setRuns(result.runs); setEvents(result.events); setProposal(JSON.stringify(result.proposal, null, 2)); setError(''); } else setError(result.code); }
    catch { setError('Desktop unavailable'); } finally { setBusy(false); }
  }
  useEffect(() => {
    const poll = () => { void window.rovdo?.browserCommand({ op: 'list' }).then((r) => { if (r.ok) { setRuns(r.runs); setEvents(r.events); setProposal(JSON.stringify(r.proposal, null, 2)); } }).catch(() => {}); };
    poll(); const timer = setInterval(poll, 1500); return () => clearInterval(timer);
  }, []);
  const latest = runs[0]; const selected = settings.profiles.find((p) => p.config.id === profile)?.config;
  return <div className="feature-view"><div className="eyebrow">SCOPED AUTOMATION</div><h1>Browser workspace</h1>
    <p>Run a reversible task in a separate visible Chromium window. Every interaction needs approval. Final submissions, login, uploads and browser network writes are disabled.</p>
    <form onSubmit={(e) => { e.preventDefault(); void command({ op: 'start', request: { task, startUrl: url, allowedOrigins: origins.split(/[\s,]+/).filter(Boolean), expectedText: expected, modelProfileId: profile, maxSteps: 20, maxUsd: 0.5, maxTokens: 50000, maxDurationMs: 300000, consent: true } }); }}>
      <label>Task<textarea value={task} onChange={(e) => setTask(e.target.value)} required /></label>
      <label>Start URL<input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required /></label>
      <label>Allowed HTTPS origins (comma separated)<input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://careers.example.com" required /></label>
      <label>Visible text that verifies completion<input value={expected} onChange={(e) => setExpected(e.target.value)} required maxLength={200} /></label>
      <label>Model<select value={profile} onChange={(e) => setProfile(e.target.value)} required><option value="">Select a tested model</option>{settings.profiles.filter((p) => p.config.capabilities?.tools === 'supported').map((p) => <option key={p.config.id} value={p.config.id}>{p.config.label} · {p.config.model}</option>)}</select></label>
      <p>Limits: 20 actions · 50,000 tokens · estimated $0.50 · 5 minutes. Model destination: {selected?.baseUrl ?? 'choose a model'}.</p>
      <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I approve sending this task and bounded, untrusted page observations to this model throughout the run. Observations appear below. Input values are excluded.</label>
      <button type="submit" disabled={!consent || busy}>Start browser task</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {latest && <section className="status-card"><h2>{latest.state}</h2><p>{latest.request.task}</p><p>{latest.lastUrl} · {latest.steps} actions · {latest.tokens} tokens · estimated ${latest.spent.toFixed(6)}</p><p>{latest.reason}</p>
      <div className="button-row"><button disabled={busy} onClick={() => void command({ op: 'control', id: latest.id, action: 'pause' })}>Pause</button><button disabled={busy || latest.state !== 'PAUSED'} onClick={() => void command({ op: 'control', id: latest.id, action: 'resume' })}>Resume in a fresh session</button><button disabled={busy} onClick={() => void command({ op: 'control', id: latest.id, action: 'cancel' })}>Stop</button></div>
      {latest.approval && <section role="region" aria-label="Action approval"><h3>Review browser interaction</h3><p>{latest.approval.summary}</p><pre>{proposal}</pre><p>Expires {new Date(latest.approval.expiresAt).toLocaleTimeString()}. Proposed input is shown only while this approval is pending and excluded from audit events.</p><button onClick={() => void command({ op: 'approve', id: latest.id, digest: latest.approval!.digest, allow: true })}>Approve this action</button><button onClick={() => void command({ op: 'approve', id: latest.id, digest: latest.approval!.digest, allow: false })}>Deny</button></section>}
      <details><summary>Page observation and outbound context</summary><pre>{latest.observation?.text}</pre></details>
      <ol>{events.map((event) => <li key={event.seq}>{event.seq}. {event.kind} · {event.detail}</li>)}</ol>
    </section>}
  </div>;
}
