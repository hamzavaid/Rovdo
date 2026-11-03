/**
 * In-memory chat transcript, streaming events and explicit outbound-conversation consent.
 * Request IDs isolate late events; only completed exchanges appear in the next request preview.
 */
import { useEffect, useRef, useState } from 'react';
import { composeChatText } from '@rovdo/shared';
import type { ChatAttachment, SettingsView } from '@rovdo/shared';
import { useActionState } from './action-state';
import { ProfileDialog } from './ProfileDialog';
import { CliAccessDialog } from './CliAccessDialog';
import { formatUsd } from './presentation';
import { errorMessage } from './messages';

export function Chat({
  settings,
  refresh,
  onConfigure,
  visible = true,
}: {
  visible?: boolean;
  settings: SettingsView;
  refresh(): Promise<void>;
  onConfigure: () => void;
}) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const attachmentRef = useRef(attachments);
  attachmentRef.current = attachments;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [picking, setPicking] = useState(false),
    [attachmentMenu, setAttachmentMenu] = useState(false);
  const [manageAccess, setManageAccess] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false),
    [voiceState, setVoiceState] = useState('stopped');
  const [voiceDialog, setVoiceDialog] = useState(false),
    [voiceConsent, setVoiceConsent] = useState(false);
  const voice = useRef<string | null>(null);
  const stickToBottom = useRef(true);
  const [profileId, setProfileId] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [budget, setBudget] = useState('1');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const { pending: resetting, label: resetLabel, run } = useActionState();
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<
    {
      role: 'You' | 'Rovdo';
      text: string;
      content?: string;
      attachments?: ChatAttachment[];
      requestId: string;
      included: boolean;
    }[]
  >([]);
  const [tools, setTools] = useState<string[]>([]);
  const [status, setStatus] = useState('Ready');
  const [usage, setUsage] = useState({ input: 0, output: 0, usd: 0, reports: 0, unknown: false });
  const transcript = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = transcript.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [entries]);
  const active = useRef<string | null>(null);
  const profile = settings.profiles.find((item) => item.config.id === profileId);
  const cli = settings.clis?.find((item) => item.profileId === profileId);
  const connectedClis = settings.clis?.filter((item) => item.status === 'connected') ?? [];
  const signature = cli
    ? JSON.stringify({
        id: cli.id,
        model: cli.model,
        version: cli.version,
        status: cli.status,
        revision: cli.revision,
        conversationRevision: cli.conversationRevision ?? 0,
      })
    : profile
      ? JSON.stringify({
          ...profile.config,
          capabilities: undefined,
          conversationRevision: profile.conversationRevision ?? 0,
        })
      : '';
  useEffect(() => {
    if (
      !profileId ||
      (!settings.profiles.some((item) => item.config.id === profileId) &&
        !connectedClis.some((item) => item.profileId === profileId))
    )
      setProfileId(settings.profiles[0]?.config.id ?? connectedClis[0]?.profileId ?? '');
  }, [settings, profileId]);
  useEffect(() => {
    if (attachmentRef.current.length)
      void window.rovdo?.releaseChatFiles({ ids: attachmentRef.current.map((a) => a.id) });
    setAttachments([]);
    setEntries([]);
    setTools([]);
    setConsent(false);
    setStatus('Ready');
    setUsage({ input: 0, output: 0, usd: 0, reports: 0, unknown: false });
  }, [signature]);
  useEffect(() => {
    if (!window.rovdo) return;
    return window.rovdo.onChatEvent((event) => {
      if (event.type === 'dictation') {
        if (event.requestId !== voice.current) return;
        if (event.state === 'text' && event.text) {
          const value = event.text;
          setText((previous) => (previous + (previous.trim() ? ' ' : '') + value).slice(0, 32000));
          setConsent(false);
        } else
          setVoiceState((previous) =>
            event.state === 'stopped' &&
            ['unavailable', 'permission-denied', 'failed'].includes(previous)
              ? previous
              : event.state,
          );
        if (event.state === 'stopped') voice.current = null;
        return;
      }
      // Late events from an earlier/canceled request must not mutate the current transcript.
      if (event.requestId !== active.current) return;
      if (event.type === 'text')
        setEntries((previous) =>
          previous.map((entry, index) =>
            index === previous.length - 1 ? { ...entry, text: entry.text + event.text } : entry,
          ),
        );
      if (event.type === 'tool') setTools((previous) => [...previous, 'workspace_info completed']);
      if (event.type === 'usage')
        setUsage((previous) => ({
          input: previous.input + event.usage.inputTokens,
          output: previous.output + event.usage.outputTokens,
          usd: previous.usd + (event.estimatedUsd ?? 0),
          reports: previous.reports + (event.usage.source === 'reported' ? 1 : 0),
          unknown: previous.unknown || event.estimatedUsd === null,
        }));
      if (event.type === 'done') {
        // Only completed exchanges are eligible for the next outbound conversation preview.
        if (event.status === 'completed')
          setEntries((previous) =>
            previous.map((entry) =>
              entry.requestId === event.requestId ? { ...entry, included: true } : entry,
            ),
          );
        active.current = null;
        setBusy(false);
        setConsent(false);
        setStatus(
          event.status === 'completed' ? 'Completed' : errorMessage[event.code ?? 'INTERNAL_ERROR'],
        );
        void refresh();
      }
    });
  }, [refresh]);
  const ready = cli
    ? cli.status === 'connected' && cli.text === 'supported'
    : !!profile &&
      ['stored', 'not-required'].includes(profile.credential) &&
      profile.config.capabilities?.tools === 'supported' &&
      profile.config.capabilities.streaming === 'supported' &&
      !!profile.config.pricing;
  const approved = cli ? !!cli.authorization?.chat : consent;
  const speaking = voiceState === 'listening' || voiceState === 'starting';
  function stopVoice() {
    const id = voice.current;
    voice.current = null;
    setVoiceState('stopped');
    if (id) void window.rovdo?.dictation({ op: 'stop', requestId: id }).catch(() => {});
  }
  async function startVoice() {
    if (voice.current || busy || resetting) return;
    setVoiceDialog(false);
    const requestId = crypto.randomUUID();
    voice.current = requestId;
    setVoiceState('starting');
    try {
      const result = await window.rovdo!.dictation({ op: 'start', requestId, consent: true });
      if (!result.ok || !result.supported) {
        voice.current = null;
        setVoiceState('unavailable');
      }
    } catch {
      voice.current = null;
      setVoiceState('failed');
    }
  }
  useEffect(() => {
    if (!visible) {
      stopVoice();
      return;
    }
    void window.rovdo
      ?.refreshClis({ force: false })
      .then(() => refresh())
      .catch(() => {});
    void window.rovdo
      ?.dictation({ op: 'status' })
      .then((result) => setVoiceSupported(!!result.ok && result.supported))
      .catch(() => setVoiceSupported(false));
    return () => stopVoice();
  }, [visible]);
  async function pick(kind: 'files' | 'folders') {
    if (picking || busy) return;
    setPicking(true);
    stopVoice();
    document.getElementById('chat-attachment-menu')?.hidePopover();
    setAttachmentMenu(false);
    try {
      const result = await window.rovdo!.pickChatFiles({ kind });
      if (!result.ok) {
        setStatus(errorMessage[result.code]);
        return;
      }
      if (!visibleRef.current) {
        void window.rovdo!.releaseChatFiles({ ids: result.attachments.map((a) => a.id) });
        return;
      }
      setAttachments((previous) => [...previous, ...result.attachments]);
      setConsent(false);
    } catch {
      setStatus(errorMessage.ATTACHMENT_UNAVAILABLE);
    } finally {
      setPicking(false);
    }
  }
  function removeAttachment(id: string) {
    setAttachments((previous) => previous.filter((a) => a.id !== id));
    setConsent(false);
    void window.rovdo?.releaseChatFiles({ ids: [id] });
  }
  async function clear() {
    if (active.current || picking) return false;
    stopVoice();
    let cleared = false;
    await run('Starting a new conversation...', async () => {
      try {
        const result = await window.rovdo!.clearChat();
        if (!result.ok) {
          setStatus(errorMessage[result.code]);
          return;
        }
        setAttachments([]);
        setEntries([]);
        setTools([]);
        setUsage({ input: 0, output: 0, usd: 0, reports: 0, unknown: false });
        setStatus('Ready');
        setConsent(false);
        await refresh();
        cleared = true;
      } catch {
        setStatus(errorMessage.INTERNAL_ERROR);
      }
    });
    return cleared;
  }
  async function send() {
    if (!ready || !approved || busy || resetting || picking || active.current || !text.trim())
      return;
    stopVoice();
    stickToBottom.current = true;
    const id = crypto.randomUUID();
    active.current = id;
    setBusy(true);
    setStatus('Generating response...');
    setEntries((previous) => [
      ...previous,
      {
        role: 'You',
        text: text.trim(),
        content: composeChatText(text.trim(), attachments),
        attachments,
        requestId: id,
        included: false,
      },
      { role: 'Rovdo', text: '', requestId: id, included: false },
    ]);
    const outgoing = text.trim();
    const selected = attachments;
    setAttachments([]);
    setText('');
    try {
      const result = await window.rovdo!.startChat({
        requestId: id,
        profileId,
        text: outgoing,
        attachmentIds: selected.map((a) => a.id),
        conversationRevision: (cli ?? profile)?.conversationRevision ?? 0,
        context: entries
          .filter((entry) => entry.included && entry.text)
          .map((entry) => ({
            role: entry.role === 'You' ? ('user' as const) : ('assistant' as const),
            content: entry.content ?? entry.text,
          })),
        consent: true,
        maxUsd: Number(budget),
        ...(cli ? { cliManagedCost: true as const } : {}),
      });
      if (!result.ok) {
        void window.rovdo!.releaseChatFiles({ ids: selected.map((a) => a.id) });
        active.current = null;
        setBusy(false);
        setStatus(errorMessage[result.code]);
      }
    } catch {
      active.current = null;
      setBusy(false);
      setStatus(errorMessage.INTERNAL_ERROR);
    }
  }
  return (
    <div className="feature-page chat-page">
      <header className="chat-heading">
        <h1>Chat</h1>
        <button
          type="button"
          className="text-action"
          disabled={busy || resetting || picking}
          onClick={() => void clear()}
        >
          + New chat
        </button>
      </header>
      <div className="chat-model-row">
        <label htmlFor="chat-model">Model</label>
        <select
          id="chat-model"
          aria-label="Model profile"
          disabled={busy || resetting || picking}
          value={profileId}
          onChange={(event) => {
            const id = event.target.value;
            void clear().then((cleared) => {
              if (cleared) setProfileId(id);
            });
          }}
        >
          <option value="">Select a model</option>
          {settings.profiles.map(({ config }) => (
            <option key={config.id} value={config.id}>
              {config.label} · {config.model}
            </option>
          ))}
          {connectedClis.length > 0 && (
            <optgroup label="Connected CLIs">
              {connectedClis.map((item) => (
                <option key={item.profileId} value={item.profileId}>
                  CLI · {item.name} · {item.model || 'Default'}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {cli && (
          <button
            className="text-action"
            onClick={() => {
              stopVoice();
              setManageAccess(true);
            }}
          >
            Manage access
          </button>
        )}
        {!cli && (
          <button
            className="text-action chat-budget-toggle"
            aria-expanded={budgetOpen}
            aria-controls="chat-budget"
            onClick={() => setBudgetOpen(!budgetOpen)}
          >
            Budget &amp; destination
          </button>
        )}
      </div>
      <div className="chat-connection help-text">
        {cli ? (
          <>
            <span className={approved ? 'status-dot' : ''} />
            {approved ? 'Chat approved' : 'Approval required'} · {cli.name} ·{' '}
            {cli.model || 'Default'}
          </>
        ) : profile ? (
          `${profile.config.model} - ${profile.config.baseUrl}`
        ) : (
          'Connect a model in Models & Privacy.'
        )}
      </div>
      <div id="chat-budget" className="chat-budget-panel" hidden={!budgetOpen || !!cli}>
        <label>
          Estimated spend limit (USD)
          <input
            type="number"
            min={0.000001}
            max={100}
            step="any"
            disabled={busy || resetting}
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              setConsent(false);
            }}
          />
        </label>
        <p className="destination">{profile?.config.baseUrl ?? 'Choose a model profile'}</p>
      </div>
      <section
        ref={transcript}
        className="transcript"
        aria-label="Conversation"
        tabIndex={0}
        aria-live="polite"
        onScroll={() => {
          const node = transcript.current;
          if (node)
            stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {entries.length === 0 && (
          <div className="empty-state">
            <h2>
              {ready
                ? 'What would you like to work on?'
                : 'Connect a model to start a conversation'}
            </h2>
            <p>Your chat stays in memory until you clear it or close Rovdo.</p>
            {!ready && (
              <button className="text-action" onClick={onConfigure}>
                Set up chat in Models &amp; Privacy
              </button>
            )}
            {ready && cli && !approved && (
              <button
                onClick={() => {
                  stopVoice();
                  setManageAccess(true);
                }}
              >
                Review CLI permissions
              </button>
            )}
          </div>
        )}
        {entries.map((entry, index) => (
          <article
            className={`chat-message ${entry.role === 'You' ? 'user-message' : ''}`}
            key={`${entry.requestId}-${index}`}
          >
            <strong>{entry.role}</strong>
            <div>{entry.text || (busy ? 'Waiting for response...' : 'No complete response.')}</div>
            {!!entry.attachments?.length && (
              <details className="chat-reference">
                <summary>{entry.attachments.length} attachment(s)</summary>
                {entry.attachments
                  .flatMap((a) => a.files)
                  .map((f, i) => (
                    <details key={i}>
                      <summary>{f.name}</summary>
                      <pre>{f.text}</pre>
                    </details>
                  ))}
              </details>
            )}
          </article>
        ))}
      </section>
      {tools.length > 0 && (
        <details className="chat-tool-summary">
          <summary>{tools.length} read-only tool result(s)</summary>
          {tools.map((tool, index) => (
            <p key={index}>{tool}</p>
          ))}
        </details>
      )}
      <form
        className="composer"
        aria-busy={busy || resetting || picking}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {attachments.length > 0 && (
          <div className="chat-attachments" aria-label="Selected attachments">
            {attachments.map((a) => (
              <span className="attachment-chip" key={a.id}>
                <span>
                  {a.name}
                  {a.kind === 'folder' ? ` (${a.files.length} files)` : ''}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(a.id)}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
        <label className="chat-message-label">
          <span className="sr-only">Message</span>
          <textarea
            aria-label="Message"
            value={text}
            disabled={busy || resetting || picking}
            maxLength={32000}
            required
            rows={3}
            placeholder="Message Rovdo..."
            onChange={(event) => {
              setText(event.target.value);
              setConsent(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        <div className="chat-composer-actions">
          <button
            type="button"
            className="chat-icon-button"
            aria-label="Attach files or folders"
            aria-expanded={attachmentMenu}
            popoverTarget="chat-attachment-menu"
            disabled={busy || resetting || picking || (!!cli && !cli.authorization?.selectedFiles)}
          >
            +
          </button>
          <span className="help-text chat-attach-hint">
            {picking ? 'Reading selected files...' : 'Attach files or folder'}
          </span>
          <div
            id="chat-attachment-menu"
            popover="auto"
            onToggle={(event) => setAttachmentMenu(event.newState === 'open')}
            className="attachment-options"
            role="group"
            aria-label="Attachment options"
          >
            <button type="button" onClick={() => void pick('files')}>
              Choose files
            </button>
            <button type="button" onClick={() => void pick('folders')}>
              Choose folders
            </button>
            <p className="help-text">
              Text/code, PDF, DOCX · up to 20 files and 64 KB extracted text. Hidden folders,
              dependencies and links are skipped.
            </p>
          </div>
          <div className="chat-send-actions">
            <button
              type="button"
              className="chat-icon-button"
              aria-label={speaking ? 'Stop dictation' : 'Start dictation'}
              aria-pressed={speaking}
              disabled={!voiceSupported || busy || resetting || picking}
              title={
                voiceSupported
                  ? 'Dictation is processed locally by Windows'
                  : 'Local dictation requires Windows and an installed speech recognizer'
              }
              onClick={() => {
                if (speaking) stopVoice();
                else if (voiceConsent) void startVoice();
                else setVoiceDialog(true);
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
              </svg>
            </button>
            {busy ? (
              <button
                type="button"
                onClick={() => {
                  if (active.current) void window.rovdo!.cancelChat({ requestId: active.current });
                }}
              >
                Stop response
              </button>
            ) : (
              <button
                className="primary-button"
                type="submit"
                aria-label="Send message"
                disabled={!ready || !approved || resetting || picking || !text.trim()}
              >
                Send
              </button>
            )}
          </div>
        </div>
        {speaking && (
          <p className="chat-listening" role="status">
            {voiceState === 'starting'
              ? 'Starting local microphone...'
              : 'Listening locally... Click the microphone to stop.'}
          </p>
        )}
        {['unavailable', 'permission-denied', 'failed'].includes(voiceState) && (
          <p role="status" className="help-text">
            {voiceState === 'permission-denied'
              ? 'Microphone access denied. Allow desktop microphone access in Windows Settings.'
              : 'Local recognition is unavailable. Install a Windows speech language and check your microphone; typing remains available.'}
          </p>
        )}
        <details className="chat-review">
          <summary>Review outbound conversation</summary>
          <p>
            {cli
              ? 'The CLI may send this visible conversation to its configured provider. Agent tools remain disabled.'
              : 'The selected endpoint receives this conversation and read-only workspace_info definition/results.'}{' '}
            Selected attachments are included as text only. Check content for secrets.
            Failed/stopped exchanges are excluded.
          </p>
          {entries
            .filter((entry) => entry.included && entry.text)
            .map((entry, index) => (
              <p className="payload-preview" key={index}>
                <strong>{entry.role}:</strong> {entry.content ?? entry.text}
              </p>
            ))}
          <p className="payload-preview">
            <strong>New message:</strong> {composeChatText(text, attachments) || '(empty)'}
          </p>
        </details>
        {!cli && (
          <label className="check-label">
            <input
              type="checkbox"
              disabled={busy || resetting}
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            Allow sending this conversation to the selected endpoint
          </label>
        )}
        {cli && !approved && (
          <button
            type="button"
            className="text-action"
            onClick={() => {
              stopVoice();
              setManageAccess(true);
            }}
          >
            Approve CLI chat access
          </button>
        )}
      </form>
      <div className="chat-footer help-text">
        <span className="usage-meter">
          {cli
            ? 'Approval is remembered · Selected files only · Cost unknown / managed by CLI'
            : usage.reports
              ? `${usage.input} input / ${usage.output} output tokens · ${usage.unknown ? 'Cost estimate unavailable' : `Estimated ${formatUsd(usage.usd)}`}`
              : 'Read-only workspace tools · Shift+Enter for a new line'}
        </span>
        <span role="status" className="operation-status">
          {resetLabel ?? (status === 'Ready' ? '' : status)}
        </span>
      </div>
      {manageAccess && cli && (
        <CliAccessDialog view={cli} refresh={refresh} onClose={() => setManageAccess(false)} />
      )}
      {voiceDialog && (
        <ProfileDialog
          title="Local voice dictation"
          onClose={() => setVoiceDialog(false)}
          closeLabel="Close voice dictation"
        >
          <p>
            Windows processes microphone audio locally using an installed speech recognizer. Rovdo
            does not upload or record audio. Transcription is inserted into your draft and is never
            sent automatically. Windows desktop microphone permission is also required.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={voiceConsent}
              onChange={(e) => setVoiceConsent(e.target.checked)}
            />
            Allow microphone access for local dictation
          </label>
          <button disabled={!voiceConsent} onClick={() => void startVoice()}>
            Start listening
          </button>
        </ProfileDialog>
      )}
    </div>
  );
}
