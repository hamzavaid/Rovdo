import { formatUsd } from './presentation';
import { useEffect, useState } from 'react';
import type { BrowserCommand, BrowserRecord, RunEvent, SettingsView } from '@rovdo/shared';

export function BrowserRun({ settings }: { settings: SettingsView }) {
  const [runs, setRuns] = useState<BrowserRecord[]>([]); const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState({ steps: 20, tokens: 50000, usd: .5, minutes: 5 });
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
    <form className="browser-task-form" onInvalidCapture={(e) => { let parent = e.target as HTMLElement | null; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } }} onChangeCapture={(e) => { if (!(e.target instanceof HTMLInputElement) || e.target.name !== 'browser-consent') setConsent(false); }} onSubmit={(e) => { e.preventDefault(); void command({ op: 'start', request: { task, startUrl: url, allowedOrigins: origins.split(/[\s,]+/).filter(Boolean), expectedText: expected, modelProfileId: profile, maxSteps: limits.steps, maxUsd: limits.usd, maxTokens: limits.tokens, maxDurationMs: limits.minutes * 60000, consent: true } }); }}>
      <label className="task-prompt">Task<textarea aria-label="Task" rows={3} maxLength={4000} placeholder="Describe the goal and what a successful result looks like" value={task} onChange={(e) => setTask(e.target.value)} required /></label>
      <label>Start URL<input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required /></label>
      <label>Model<select value={profile} onChange={(e) => setProfile(e.target.value)} required><option value="">Select a tested model</option>{settings.profiles.filter((p) => p.config.capabilities?.tools === 'supported').map((p) => <option key={p.config.id} value={p.config.id}>{p.config.label} · {p.config.model}</option>)}</select></label>
      <details className="surface-disclosure"><summary>Scope and safety settings</summary><p className="help-text">Required before starting: name every permitted HTTPS origin and the visible evidence that will verify completion. No permissions are inferred from page content.</p>      <label>Allowed HTTPS origins (comma separated)<input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://careers.example.com" required /></label>
      <label>Visible text that verifies completion<input value={expected} onChange={(e) => setExpected(e.target.value)} required maxLength={200} /></label>
</details>
      <details className="surface-disclosure"><summary>Execution limits</summary><div className="career-fields"><label>Maximum actions<input type="number" min={1} max={100} value={limits.steps} onChange={(e) => setLimits({ ...limits, steps: Number(e.target.value) })} /></label><label>Token limit<input type="number" min={1} max={100000} value={limits.tokens} onChange={(e) => setLimits({ ...limits, tokens: Number(e.target.value) })} /></label><label>Spend limit (USD)<input type="number" min={0} max={100} step="any" value={limits.usd} onChange={(e) => setLimits({ ...limits, usd: Number(e.target.value) })} /></label><label>Time limit (minutes)<input type="number" min={1} max={30} value={limits.minutes} onChange={(e) => setLimits({ ...limits, minutes: Number(e.target.value) })} /></label></div></details>
      <p className="help-text">Model destination: {selected?.baseUrl ?? 'choose a tested model'}. Every interaction still requires approval.</p>
      <label><input name="browser-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I approve sending this task and bounded, untrusted page observations to this model throughout the run. Observations appear below. Input values are excluded.</label>
      <button type="submit" disabled={!consent || busy}>Start browser task</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {latest && <section className="status-card"><h2>{latest.state}</h2><p>{latest.request.task}</p><p>{latest.lastUrl} · {latest.steps} actions · {latest.tokens} tokens · estimated {formatUsd(latest.spent)}</p><p>{latest.reason}</p>
      <div className="button-row"><button disabled={busy} onClick={() => void command({ op: 'control', id: latest.id, action: 'pause' })}>Pause</button><button disabled={busy || latest.state !== 'PAUSED'} onClick={() => void command({ op: 'control', id: latest.id, action: 'resume' })}>Resume in a fresh session</button><button disabled={busy} onClick={() => void command({ op: 'control', id: latest.id, action: 'cancel' })}>Stop</button></div>
      {latest.approval && <section role="region" aria-label="Action approval"><h3>Review browser interaction</h3><p>{latest.approval.summary}</p><pre>{proposal}</pre><p>Expires {new Date(latest.approval.expiresAt).toLocaleTimeString()}. Proposed input is shown only while this approval is pending and excluded from audit events.</p><button onClick={() => void command({ op: 'approve', id: latest.id, digest: latest.approval!.digest, allow: true })}>Approve this action</button><button onClick={() => void command({ op: 'approve', id: latest.id, digest: latest.approval!.digest, allow: false })}>Deny</button></section>}
      <details><summary>Page observation and outbound context</summary><pre>{latest.observation?.text}</pre></details>
      <ol>{events.map((event) => <li key={event.seq}>{event.seq}. {event.kind} · {event.detail}</li>)}</ol>
    </section>}
  </div>;
}
