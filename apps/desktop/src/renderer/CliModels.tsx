/** Local CLI cards disclose remote inference and unknown billing without collecting CLI credentials. */
import { useEffect, useRef, useState } from 'react';
import { CliPreferenceSchema } from '@rovdo/shared';
import type { CliId, CliView, Result } from '@rovdo/shared';
import { ProfileDialog } from './ProfileDialog';
import { CliAccessDialog } from './CliAccessDialog';
import { OperationStatus } from './OperationStatus';
import { useActionState } from './action-state';
import { errorMessage } from './messages';

const statusLabel: Record<CliView['status'], string> = {
  'not-installed': 'Not installed',
  installed: 'Installed · test required',
  'authentication-required': 'Authentication required',
  'unsupported-version': 'Unsupported version',
  'unsupported-mode': 'Restricted chat unavailable',
  connected: 'Connected',
  unavailable: 'Unavailable',
};
const safety: Partial<Record<CliId, string>> = {
  gemini:
    'Detected for visibility. Gemini policy, hooks and extension isolation have not been verified for this integration. Chat is disabled rather than starting an unrestricted agent.',
  qwen: 'Detected for visibility. Qwen core-tool allowlists do not cover every tool category. Chat is disabled until a complete tool/configuration isolation contract is verified.',
};
function CliCard({
  view,
  busy,
  save,
  test,
  access,
  revoke,
}: {
  view: CliView;
  busy: boolean;
  save: (value: unknown) => void;
  test: () => void;
  access: () => void;
  revoke: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [model, setModel] = useState(view.model);
  const [timeout, setTimeout] = useState(view.timeoutMs);
  const [custom, setCustom] = useState(!!view.model && !view.models.includes(view.model));
  useEffect(() => {
    setModel(view.model);
    setTimeout(view.timeoutMs);
    setCustom(!!view.model && !view.models.includes(view.model));
  }, [view.model, view.timeoutMs, view.models.join('|')]);
  const installed = view.status !== 'not-installed';
  const supported =
    !safety[view.id] &&
    view.status !== 'unsupported-mode' &&
    view.status !== 'unsupported-version' &&
    view.status !== 'unavailable';
  const dirty = model !== view.model || timeout !== view.timeoutMs;
  const valid = CliPreferenceSchema.safeParse({ id: view.id, model, timeoutMs: timeout }).success;
  return (
    <article
      className={`cli-card ${view.status === 'connected' ? 'cli-connected' : ''}`}
      aria-label={view.name}
    >
      <div className="cli-card-heading">
        <span className="cli-icon" aria-hidden="true">
          {view.id === 'ollama' ? '◉' : '>_'}
        </span>
        <div className="cli-identity">
          <h3>{view.name}</h3>
          <span className="help-text">
            {view.version ? `${view.id} ${view.version}` : statusLabel[view.status]}
          </span>
        </div>
        {view.model && (
          <span className="cli-model-badge" title={view.model}>
            {view.model}
          </span>
        )}
        <span className={`cli-state ${view.status === 'connected' ? 'cli-ready' : ''}`}>
          {statusLabel[view.status]}
        </span>
        {installed && (
          <button
            type="button"
            disabled={busy || !supported || dirty}
            onClick={test}
            aria-label={`Test ${view.name}`}
          >
            Test
          </button>
        )}
        {installed && (
          <button
            type="button"
            className="text-action"
            disabled={busy}
            aria-label={`Configure ${view.name}`}
            aria-expanded={expanded}
            aria-controls={`cli-config-${view.id}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide' : 'Configure'}
          </button>
        )}
      </div>
      {view.status === 'connected' && (
        <div className="cli-access-row">
          <span className="help-text">
            {view.authorization?.chat ? 'Chat approved' : 'Chat approval required'}
            {view.authorization?.selectedFiles ? ' · Selected snapshots allowed' : ''}
          </span>
          <button type="button" className="text-action" disabled={busy} onClick={access}>
            Manage permissions
          </button>
          {view.authorization?.chat && (
            <button type="button" className="text-action" disabled={busy} onClick={revoke}>
              Revoke access
            </button>
          )}
        </div>
      )}
      {installed && expanded && (
        <div id={`cli-config-${view.id}`} className="cli-config">
          {safety[view.id] && <p className="help-text">{safety[view.id]}</p>}
          {view.id === 'codex' && (
            <p className="help-text">
              Text chat is reviewed for Codex 0.165.0 only. Tools, hooks, skills and user
              configuration are disabled. Global ~/.codex/AGENTS.md and AGENTS.override.md must be
              absent or empty. Default uses Codex’s built-in model; choose a custom ID to override
              it. Token streaming is not verified.
            </p>
          )}
          {view.status === 'unsupported-version' && (
            <p role="note">
              {view.id === 'codex'
                ? 'Only Codex 0.165.0 has a reviewed isolation contract. Other versions require another review.'
                : view.id === 'claude'
                  ? 'Claude Code 2.1.248 or later in the 2.1 release line is required for restricted mode.'
                  : 'The installed CLI version could not be verified.'}{' '}
              Manage CLI versions separately, then refresh.
            </p>
          )}
          <div className="cli-config-grid">
            <label>
              Model for {view.name}
              <select
                aria-label={`Model for ${view.name}`}
                disabled={busy}
                value={custom ? '__custom' : model}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustom(value === '__custom');
                  setModel(value === '__custom' ? '' : value);
                }}
              >
                <option value="">
                  {view.id === 'ollama'
                    ? 'Default · first installed model'
                    : view.id === 'codex'
                      ? 'Default · Codex built-in model'
                      : 'Default · CLI configured model'}
                </option>
                {view.models.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
                <option value="__custom">Custom model ID…</option>
              </select>
            </label>
            {custom && (
              <label>
                Custom model ID for {view.name}
                <input
                  disabled={busy}
                  value={model}
                  maxLength={150}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Provider model ID"
                />
              </label>
            )}
            <label>
              Response timeout (seconds)
              <input
                type="number"
                min={5}
                max={300}
                disabled={busy}
                value={timeout / 1000}
                onChange={(e) => setTimeout(Number(e.target.value) * 1000)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !dirty || !valid}
              onClick={() => save({ id: view.id, model, timeoutMs: timeout })}
            >
              Save CLI preferences
            </button>
          </div>
          {!valid && (
            <p role="alert">
              Use a model ID starting with a letter or digit, containing only letters, digits, dots,
              underscores, slashes, colons or hyphens. Timeout: 5–300 seconds.
            </p>
          )}
          <p className="help-text">
            {view.id === 'ollama'
              ? 'Uses installed models at 127.0.0.1:11434. Rovdo never starts the server or downloads models.'
              : 'Default retains CLI model selection; custom IDs require a successful test. Authenticate separately in your terminal.'}{' '}
            {dirty ? 'Save changes before testing.' : ''}
          </p>
          <p className="help-text">
            Text: {view.text === 'supported' ? 'tested' : 'not tested'} · Streaming:{' '}
            {view.streaming === 'supported' ? 'tested' : 'not verified'} · Rovdo tools, images and
            structured output: unavailable. Cost unknown / managed by CLI.
          </p>
        </div>
      )}
    </article>
  );
}
export function CliModels({
  views,
  active,
  refresh,
}: {
  views: CliView[];
  active: boolean;
  refresh: () => Promise<void>;
}) {
  const { pending: busy, label, run } = useActionState();
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState<CliView | null>(null);
  const [accessId, setAccessId] = useState<CliId | null>(null);
  const [consent, setConsent] = useState(false);
  const request = useRef<string | null>(null);
  async function action(text: string, work: () => Promise<Result>) {
    await run(text, async () => {
      try {
        const result = await work();
        setMessage(result.ok ? 'CLI status updated.' : errorMessage[result.code]);
        await refresh();
      } catch {
        setMessage(errorMessage.INTERNAL_ERROR);
      }
    });
  }
  useEffect(() => {
    if (active && window.rovdo)
      void action('Checking installed CLIs…', () => window.rovdo!.refreshClis());
  }, [active]);
  async function test() {
    if (!testing || !consent || request.current) return;
    const id = crypto.randomUUID();
    request.current = id;
    const target = testing;
    let tested = false;
    await action(`Testing ${target.name}…`, async () => {
      const result = await window.rovdo!.testCli({ id: target.id, requestId: id, consent: true });
      tested = result.ok;
      return result;
    });
    request.current = null;
    setTesting(null);
    setConsent(false);
    if (tested && !target.authorization?.chat) setAccessId(target.id);
  }
  function close() {
    if (request.current) void window.rovdo!.cancelChat({ requestId: request.current });
    setTesting(null);
    setConsent(false);
  }
  return (
    <section className="cli-section" aria-labelledby="cli-title" aria-busy={busy}>
      <div className="section-heading">
        <div>
          <h2 id="cli-title">Connect your CLI</h2>
          <p className="help-text">
            Use an installed CLI with its existing sign-in. No API key is entered into Rovdo.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void action('Refreshing CLI detection…', () => window.rovdo!.refreshClis())
          }
        >
          Refresh CLIs
        </button>
      </div>
      <p className="help-text">
        The executable runs on this computer. Codex, Claude, Gemini and Qwen can send content to
        remote services configured by their CLI. Ollama may run locally or use cloud-backed models.
        Subscriptions, limits or provider charges may apply; Rovdo cannot enforce API spending
        limits on CLI requests. Cost unknown / managed by CLI.
      </p>
      <OperationStatus label={label} />
      <div className="cli-list">
        {views.map((view) => (
          <CliCard
            view={view}
            key={view.id}
            busy={busy}
            access={() => setAccessId(view.id)}
            revoke={() => {
              if (view.accessIdentity)
                void action('Revoking CLI access...', () =>
                  window.rovdo!.setCliAccess({
                    id: view.id,
                    identity: view.accessIdentity!,
                    chat: false,
                    selectedFiles: false,
                  }),
                );
            }}
            save={(value) =>
              void action('Saving CLI preferences…', () =>
                window.rovdo!.saveCli(CliPreferenceSchema.parse(value)),
              )
            }
            test={() => {
              setConsent(false);
              setTesting(view);
            }}
          />
        ))}
      </div>
      <p role="status" className="help-text">
        {message}
      </p>
      {accessId && views.find((v) => v.id === accessId)?.status === 'connected' && (
        <CliAccessDialog
          view={views.find((v) => v.id === accessId)!}
          refresh={refresh}
          onClose={() => setAccessId(null)}
        />
      )}
      {testing && (
        <ProfileDialog
          title={`Test ${testing.name}`}
          onClose={close}
          closeLabel="Close CLI connection test"
        >
          <p>
            This sends one small request using {testing.name} and{' '}
            {testing.model || 'its default model'}. It may contact the service configured by your
            CLI. Cost unknown / managed by CLI.
          </p>
          <p className="payload-preview">Reply with ROVDO_OK only.</p>
          <p>
            No profile, jobs, files or chat history are included. Tools are disabled. The test is
            limited to 20 seconds.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Allow this test request and CLI-managed usage charges
          </label>
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              disabled={busy || !consent}
              onClick={() => void test()}
            >
              Run connection test
            </button>
            <button type="button" onClick={close}>
              {busy ? 'Cancel test' : 'Cancel'}
            </button>
          </div>
        </ProfileDialog>
      )}
    </section>
  );
}
