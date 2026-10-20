/**
 * Model setup and configuration UI with credential status, capability probes and pricing.
 * Key entry uses a native main-process dialog; the renderer handles no key values.
 */
import { useEffect, useState } from 'react';
import { ProviderConfigSchema } from '@rovdo/shared';
import type { ProviderConfig, Result, SettingsView } from '@rovdo/shared';
import { OperationStatus } from './OperationStatus';
import { useActionState } from './action-state';
import { formatUsd } from './presentation';
import { errorMessage } from './messages';

type Rates = { input: string; output: string; cached: string; version: string };
const emptyRates: Rates = { input: '', output: '', cached: '', version: '' };
function draftOf(config: ProviderConfig): ProviderConfig {
  const { capabilities, ...draft } = config;
  void capabilities;
  return draft;
}

export function Models({
  settings,
  refresh,
}: {
  settings: SettingsView;
  refresh(): Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [rates, setRates] = useState<Rates>(emptyRates);
  const [message, setMessage] = useState('');
  const { pending: busy, label: actionLabel, run } = useActionState();
  const [consent, setConsent] = useState(false);
  const saved = settings.profiles.find((profile) => profile.config.id === selected);
  useEffect(() => {
    if (!selected && settings.profiles.length) {
      setSelected(settings.profiles[0]!.config.id);
      return;
    }
    const profile = settings.profiles.find((item) => item.config.id === selected);
    if (profile) {
      setDraft(draftOf(profile.config));
      const prices = profile.config.pricing;
      setRates(
        prices
          ? {
              input: String(prices.inputPerMillion),
              output: String(prices.outputPerMillion),
              cached:
                prices.cachedInputPerMillion === undefined
                  ? ''
                  : String(prices.cachedInputPerMillion),
              version: prices.version,
            }
          : emptyRates,
      );
    }
  }, [settings, selected]);

  async function action(work: () => Promise<Result>, success: string) {
    let succeeded = false;
    await run('Updating model settings...', async () => {
      setMessage('Working...');
      try {
        const result = await work();
        setMessage(result.ok ? success : errorMessage[result.code]);
        await refresh();
        succeeded = result.ok;
      } catch {
        setMessage(errorMessage.INTERNAL_ERROR);
      }
    });
    return succeeded;
  }
  function edit(value: Partial<ProviderConfig>) {
    if (draft) setDraft({ ...draft, ...value });
  }
  function select(id: string) {
    setSelected(id);
    setConsent(false);
    setMessage('');
  }
  function create() {
    const id = crypto.randomUUID();
    select(id);
    setRates(emptyRates);
    setDraft({
      id,
      label: '',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: '',
      timeoutMs: 30_000,
      maxOutputTokens: 1024,
      includeUsage: true,
    });
  }
  async function save() {
    if (!draft || !window.rovdo) return;
    const next = draftOf(draft);
    delete next.pricing;
    if (Object.values(rates).some(Boolean)) {
      if (!rates.input || !rates.output || !rates.version) {
        setMessage(
          'Enter input/output rates and a pricing version, or leave all pricing fields empty.',
        );
        return;
      }
      next.pricing = {
        inputPerMillion: Number(rates.input),
        outputPerMillion: Number(rates.output),
        version: rates.version,
        ...(rates.cached ? { cachedInputPerMillion: Number(rates.cached) } : {}),
      };
    }
    const parsed = ProviderConfigSchema.safeParse(next);
    if (!parsed.success) {
      setMessage(errorMessage.VALIDATION_ERROR);
      return;
    }
    await action(() => window.rovdo!.saveProfile(parsed.data), 'Profile saved.');
  }

  return (
    <div className="feature-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR MODELS, YOUR CONTROL</div>
          <h1>Models &amp; Privacy</h1>
        </div>
        <button type="button" onClick={create} disabled={busy}>
          New profile
        </button>
      </div>
      <p className="intro">
        Configure a model and its destination. API keys are entered in a native password dialog and
        stored in your OS credential vault. They never enter this interface.
      </p>
      {!settings.profiles.length && (
        <section className="setup-guide surface-card">
          <h2>Connect your first model</h2>
          <ol className="setup-steps">
            <li>
              <strong>1. Configure</strong>
              <span>Choose your provider, model ID and rates.</span>
            </li>
            <li>
              <strong>2. Store your key</strong>
              <span>Enter it in the native OS vault dialog.</span>
            </li>
            <li>
              <strong>3. Test &amp; use</strong>
              <span>Approve a small connection test, then open Chat.</span>
            </li>
          </ol>
          {!draft && (
            <button className="primary-button" onClick={create}>
              Set up first model
            </button>
          )}
        </section>
      )}
      <div className="settings-layout">
        <div className="profile-list" aria-label="Provider profiles">
          {settings.profiles.length === 0 && <p>No profiles yet. Create one to get started.</p>}
          {settings.profiles.map(({ config, credential }) => (
            <button
              className={selected === config.id ? 'selected' : ''}
              type="button"
              key={config.id}
              aria-label={`Edit ${config.label}`}
              disabled={busy}
              onClick={() => select(config.id)}
            >
              <strong>{config.label}</strong>
              <small>
                {config.kind} · {config.model}
              </small>
              <span className="connection-badge">
                {config.capabilities?.streaming === 'supported' &&
                config.capabilities.tools === 'supported' &&
                ['stored', 'not-required'].includes(credential)
                  ? 'Streaming & tools tested'
                  : credential === 'missing'
                    ? 'Key needed'
                    : 'Setup or test needed'}
              </span>
              {config.pricing && (
                <small>
                  Input {formatUsd(config.pricing.inputPerMillion)}
                  {' / output '}
                  {formatUsd(config.pricing.outputPerMillion)} per million tokens
                </small>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              void action(async () => ({ ok: true }), 'Status refreshed.');
            }}
            disabled={busy}
          >
            Refresh status
          </button>
        </div>
        {draft && (
          <section className="editor-panel" aria-label="Provider settings">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={busy}>
                <legend>Provider profile</legend>
                <div className="form-grid">
                  <label>
                    Profile name
                    <input
                      value={draft.label}
                      maxLength={80}
                      required
                      onChange={(event) => edit({ label: event.target.value })}
                    />
                  </label>
                  <label>
                    Provider type
                    <select
                      value={draft.kind}
                      onChange={(event) => {
                        const kind = event.target.value as ProviderConfig['kind'];
                        setConsent(false);
                        edit({
                          kind,
                          authMode: 'api-key',
                          baseUrl:
                            kind === 'openai'
                              ? 'https://api.openai.com/v1'
                              : kind === 'anthropic'
                                ? 'https://api.anthropic.com'
                                : '',
                        });
                      }}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="compatible">OpenAI-compatible</option>
                    </select>
                  </label>
                  <label className="wide">
                    Endpoint URL
                    <input
                      type="url"
                      required
                      value={draft.baseUrl}
                      readOnly={draft.kind !== 'compatible'}
                      placeholder="https://your-provider.example/v1"
                      onChange={(event) => {
                        setConsent(false);
                        edit({ baseUrl: event.target.value });
                      }}
                    />
                  </label>
                  <label>
                    Model ID
                    <input
                      required
                      value={draft.model}
                      maxLength={200}
                      placeholder="Use an ID available to your account"
                      onChange={(event) => edit({ model: event.target.value })}
                    />
                  </label>
                </div>
                <details className="surface-disclosure">
                  <summary>Advanced model settings</summary>
                  <div className="form-grid">
                    <label>
                      Maximum output tokens
                      <input
                        type="number"
                        min={32}
                        max={32768}
                        step={1}
                        value={draft.maxOutputTokens}
                        required
                        onChange={(event) => edit({ maxOutputTokens: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Request timeout (seconds)
                      <input
                        type="number"
                        min={1}
                        max={300}
                        required
                        value={draft.timeoutMs / 1000}
                        onChange={(event) => edit({ timeoutMs: Number(event.target.value) * 1000 })}
                      />
                    </label>
                    <label>
                      Temperature (optional)
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={draft.temperature ?? ''}
                        onChange={(event) => {
                          const next = { ...draft };
                          if (event.target.value === '') delete next.temperature;
                          else next.temperature = Number(event.target.value);
                          setDraft(next);
                        }}
                      />
                    </label>
                    <label className="wide">
                      HTTPS proxy URL (optional, no credentials)
                      <input
                        type="url"
                        value={draft.proxyUrl ?? ''}
                        placeholder="https://proxy.example:443"
                        onChange={(event) => {
                          const next = { ...draft };
                          if (!event.target.value) delete next.proxyUrl;
                          else next.proxyUrl = event.target.value;
                          setDraft(next);
                        }}
                      />
                    </label>
                  </div>
                </details>
                {draft.kind === 'compatible' && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={draft.authMode === 'none'}
                      onChange={(event) =>
                        edit({ authMode: event.target.checked ? 'none' : 'api-key' })
                      }
                    />
                    This compatible endpoint does not require an API key
                  </label>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.includeUsage}
                    onChange={(event) => edit({ includeUsage: event.target.checked })}
                  />
                  Request streaming usage reports (disable if a compatible endpoint rejects this
                  option)
                </label>
                <h2>Cost estimates</h2>
                <p className="help-text">
                  Enter current model rates from your provider and a date or version. These are
                  estimates, not billing guarantees. Chat needs rates to check its spend limit; use
                  zero only for a verified free endpoint.
                </p>
                <div className="form-grid">
                  <label>
                    Input USD per million tokens
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={rates.input}
                      onChange={(event) => setRates({ ...rates, input: event.target.value })}
                    />
                  </label>
                  <label>
                    Output USD per million tokens
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={rates.output}
                      onChange={(event) => setRates({ ...rates, output: event.target.value })}
                    />
                  </label>
                  <label>
                    Cached input USD per million tokens
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={rates.cached}
                      onChange={(event) => setRates({ ...rates, cached: event.target.value })}
                    />
                  </label>
                  <label>
                    Pricing version
                    <input
                      value={rates.version}
                      maxLength={80}
                      placeholder="Provider rates YYYY-MM-DD"
                      onChange={(event) => setRates({ ...rates, version: event.target.value })}
                    />
                  </label>
                </div>
                <button className="primary-button" type="submit">
                  Save profile
                </button>
              </fieldset>
            </form>
            {saved && (
              <div className="credential-section">
                <h2>Credential &amp; connection</h2>
                <p>
                  {saved.credential === 'not-required'
                    ? 'No API key required'
                    : saved.credential === 'stored'
                      ? 'Key stored in OS vault'
                      : saved.credential === 'missing'
                        ? 'No key stored'
                        : 'OS vault unavailable'}
                </p>
                <div className="button-row">
                  {saved.credential !== 'not-required' && (
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        void action(
                          () => window.rovdo!.enterKey({ profileId: selected }),
                          'Credential dialog closed.',
                        );
                      }}
                    >
                      Enter API key securely
                    </button>
                  )}
                  {saved.credential !== 'not-required' && (
                    <button
                      disabled={busy || saved.credential !== 'stored'}
                      type="button"
                      onClick={() => {
                        void action(
                          () => window.rovdo!.removeKey({ profileId: selected }),
                          'Key removed.',
                        );
                      }}
                    >
                      Remove key
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      void action(
                        () => window.rovdo!.removeProfile({ profileId: selected }),
                        'Profile deleted.',
                      ).then((deleted) => {
                        if (deleted) {
                          setDraft(null);
                          setSelected('');
                        }
                      });
                    }}
                  >
                    Delete profile
                  </button>
                </div>
                <p className="help-text">
                  {'Testing sends a small prompt requesting workspace_info to '}
                  <strong>{saved.config.baseUrl}</strong> with your selected model and saved
                  settings. It can incur API charges. No browser access is enabled.
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  Allow the connection test to send a small tool-call prompt to this endpoint
                </label>
                <button
                  type="button"
                  disabled={
                    busy || !consent || !['stored', 'not-required'].includes(saved.credential)
                  }
                  onClick={() => {
                    void action(
                      () => window.rovdo!.testConnection({ profileId: selected, consent: true }),
                      'Connection verified: streaming and tools.',
                    );
                  }}
                >
                  Test connection
                </button>
                <div className="capabilities" aria-label="Verified model capabilities">
                  <span>Streaming: {saved.config.capabilities?.streaming ?? 'unknown'}</span>
                  <span>Tools: {saved.config.capabilities?.tools ?? 'unknown'}</span>
                  <span>Usage: {saved.config.capabilities?.reportedUsage ?? 'unknown'}</span>
                  <span>Vision / structured output: unknown</span>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      <OperationStatus label={actionLabel} />
      <p className="operation-status" role="status">
        {message}
      </p>
    </div>
  );
}
