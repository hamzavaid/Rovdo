import { useEffect, useRef, useState } from 'react';
import type { SettingsView } from '@rovdo/shared';
import { errorMessage } from './messages';

export function Chat({ settings, refresh }: { settings: SettingsView; refresh(): Promise<void> }) {
  const [profileId, setProfileId] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [budget, setBudget] = useState('1');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<{ role: 'You' | 'Rovdo'; text: string; requestId: string; included: boolean }[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [status, setStatus] = useState('Ready');
  const [usage, setUsage] = useState({ input: 0, output: 0, usd: 0, reports: 0, unknown: false });
  const active = useRef<string | null>(null);
  const profile = settings.profiles.find((item) => item.config.id === profileId);
  const signature = profile ? JSON.stringify(profile.config) : '';
  useEffect(() => {
    if (!profileId || !settings.profiles.some((item) => item.config.id === profileId)) setProfileId(settings.profiles[0]?.config.id ?? '');
  }, [settings, profileId]);
  useEffect(() => { setEntries([]); setTools([]); setConsent(false); setStatus('Ready'); setUsage({ input: 0, output: 0, usd: 0, reports: 0, unknown: false }); }, [signature]);
  useEffect(() => {
    if (!window.rovdo) return;
    return window.rovdo.onChatEvent((event) => {
      if (event.requestId !== active.current) return;
      if (event.type === 'text') setEntries((previous) => previous.map((entry, index) => index === previous.length - 1 ? { ...entry, text: entry.text + event.text } : entry));
      if (event.type === 'tool') setTools((previous) => [...previous, 'workspace_info completed']);
      if (event.type === 'usage') setUsage((previous) => ({ input: previous.input + event.usage.inputTokens, output: previous.output + event.usage.outputTokens, usd: previous.usd + (event.estimatedUsd ?? 0), reports: previous.reports + (event.usage.source === 'reported' ? 1 : 0), unknown: previous.unknown || event.estimatedUsd === null }));
      if (event.type === 'done') {
        if (event.status === 'completed') setEntries((previous) => previous.map((entry) => entry.requestId === event.requestId ? { ...entry, included: true } : entry));
        active.current = null; setBusy(false); setConsent(false);
        setStatus(event.status === 'completed' ? 'Completed' : errorMessage[event.code ?? 'INTERNAL_ERROR']);
        void refresh();
      }
    });
  }, [refresh]);
  const ready = !!profile && ['stored', 'not-required'].includes(profile.credential) && profile.config.capabilities?.tools === 'supported' && profile.config.capabilities.streaming === 'supported' && !!profile.config.pricing;
  async function clear() {
    try {
      const result = await window.rovdo!.clearChat();
      if (!result.ok) { setStatus(errorMessage[result.code]); return false; }
      setEntries([]); setTools([]); setUsage({ input: 0, output: 0, usd: 0, reports: 0, unknown: false }); setStatus('Ready'); setConsent(false);
      return true;
    } catch { setStatus(errorMessage.INTERNAL_ERROR); return false; }
  }
  async function send() {
    if (!ready || !consent || busy || !text.trim()) return;
    const id = crypto.randomUUID(); active.current = id; setBusy(true); setStatus('Streaming…');
    setEntries((previous) => [...previous, { role: 'You', text: text.trim(), requestId: id, included: false }, { role: 'Rovdo', text: '', requestId: id, included: false }]);
    const outgoing = text.trim(); setText('');
    try {
      const result = await window.rovdo!.startChat({ requestId: id, profileId, text: outgoing, consent: true, maxUsd: Number(budget) });
      if (!result.ok) { active.current = null; setBusy(false); setStatus(errorMessage[result.code]); }
    } catch { active.current = null; setBusy(false); setStatus(errorMessage.INTERNAL_ERROR); }
  }
  return (
    <div className="feature-page chat-page">
      <div className="page-heading"><div><div className="eyebrow">A CONVERSATION, ON YOUR TERMS</div><h1>Chat</h1></div><div className="button-row"><button type="button" disabled={!busy} onClick={() => { if (active.current) void window.rovdo!.cancelChat({ requestId: active.current }).catch(() => setStatus(errorMessage.INTERNAL_ERROR)); }}>Stop response</button><button type="button" disabled={busy} onClick={() => { void clear(); }}>New conversation</button></div></div>
      <div className="chat-controls">
        <label>Model profile<select disabled={busy} value={profileId} onChange={(event) => { const id = event.target.value; setConsent(false); void clear().then((cleared) => { if (cleared) setProfileId(id); }); }}><option value="">Select a profile</option>{settings.profiles.map(({ config }) => <option key={config.id} value={config.id}>{config.label} · {config.model}</option>)}</select></label>
        <label>Estimated spend limit (USD)<input type="number" min={0.000001} max={100} step="any" disabled={busy} value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
      </div>
      <p className="destination">{profile ? `${profile.config.kind} · ${profile.config.model} → ${profile.config.baseUrl}` : 'Create a model profile in Models & Privacy first.'}</p>
      {!ready && <p className="help-text">Configure authentication, verify streaming and tool support, and set pricing before sending a message.</p>}
      <section className="transcript" aria-label="Conversation" aria-live="polite">
        {entries.length === 0 && <p className="empty-chat">Start a conversation. Your chat stays in memory until you clear it or close Rovdo.</p>}
        {entries.map((entry, index) => <article className={`chat-message ${entry.role === 'You' ? 'user-message' : ''}`} key={index}><strong>{entry.role}</strong><div>{entry.text || (busy ? 'Waiting for response…' : 'No complete response.')}</div></article>)}
      </section>
      {tools.map((tool, index) => <p className="tool-note" key={index}>{tool}</p>)}
      <div className="usage-meter">{usage.reports ? `${usage.input} input / ${usage.output} output tokens · ${usage.unknown ? 'Cost estimate unavailable for some calls' : `Estimated $${usage.usd.toFixed(6)}`}` : 'Token usage and costs appear when reported by the provider.'}</div>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label>Message<textarea value={text} disabled={busy} maxLength={32000} required rows={3} placeholder="What would you like to work through?" onChange={(event) => { setText(event.target.value); setConsent(false); }} /></label>
        <details><summary>Review outbound conversation</summary><p>Completed exchanges listed here, your new message, and the read-only workspace_info definition/results are sent to the selected endpoint. Failed or stopped exchanges are excluded. No credentials, screenshots or files are included in the prompt.</p>{entries.filter((entry) => entry.included && entry.text).map((entry, index) => <p className="payload-preview" key={index}><strong>{entry.role}:</strong> {entry.text}</p>)}<p className="payload-preview"><strong>New message:</strong> {text || '(empty)'}</p></details>
        <label className="check-label"><input type="checkbox" disabled={busy} checked={consent} onChange={(event) => setConsent(event.target.checked)} />Allow sending this conversation to the selected endpoint</label>
        <div className="button-row"><button className="primary-button" type="submit" disabled={!ready || !consent || busy || !text.trim()}>Send message</button><span className="help-text">Tools can only read Rovdo workspace metadata.</span></div>
      </form>
      <p role="status" className="operation-status">{status}</p>
    </div>
  );
}
