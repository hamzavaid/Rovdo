/**
 * Import and ranking-profile workflows backed by the intelligence command API.
 * Edits remain local until an explicit merge/save; built-in rankings must be cloned before customization.
 */
import { ImportAssistance } from './ImportAssistance';
import { ImportReview } from './ImportReview';
import { OperationStatus } from './OperationStatus';
import { useActionState } from './action-state';
import { useEffect, useState } from 'react';
import { RankingEditor } from './RankingEditor';
import { editorWeights, totalWeight } from './ranking-weights';
import { IntelligenceSchema, RankingProfileSchema, importFailureMessage } from '@rovdo/shared';
import type {
  CandidateProfile,
  ImportPreview,
  IntelligenceCommand,
  IntelligenceView,
  RankingProfile,
  SettingsView,
} from '@rovdo/shared';

const editable = (p: RankingProfile) =>
  p.id.startsWith('builtin:') ? p : { ...p, weights: editorWeights(p.weights) };

export function ProfileIntelligence({
  tab,
  settings,
  onChanged,
  onSelected,
}: {
  settings: SettingsView;
  onSelected?: (id: string) => void;
  tab: 'profile' | 'jobs';
  onChanged: (profile: CandidateProfile | null) => void;
}) {
  const [view, setView] = useState<IntelligenceView | null>(null);
  const [error, setError] = useState('');
  const { pending: busy, label: actionLabel, run } = useActionState();
  const [paste, setPaste] = useState('');
  const [kind, setKind] = useState<'file' | 'linkedin'>('linkedin');
  const [github, setGithub] = useState('');
  const [githubConsent, setGithubConsent] = useState(false);
  const [draft, setDraft] = useState<ImportPreview | null>(null);
  const [rankingId, setRankingId] = useState('');
  const [ranking, setRanking] = useState<RankingProfile | null>(null);
  const [transfer, setTransfer] = useState('');
  const [resetPreset, setResetPreset] = useState('builtin:technical-balanced');
  const [manageOpen, setManageOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  useEffect(() => {
    void window
      .rovdo!.intelligenceCommand({ op: 'view' })
      .then((r) => {
        if (r.ok) {
          setView(r.view);
          setRankingId(r.view.defaultRanking);
          setRanking(editable(r.view.rankings.find((p) => p.id === r.view.defaultRanking)!));
        } else setError(r.code);
      })
      .catch(() => setError('Desktop unavailable'));
  }, []);
  async function command(input: IntelligenceCommand) {
    await run(
      input.op === 'assistImport'
        ? 'Preparing AI extraction suggestions...'
        : ['paste', 'github', 'importFile', 'importTranscript'].includes(input.op)
          ? 'Preparing import preview...'
          : input.op === 'applyImport'
            ? 'Verifying and merging qualifications...'
            : 'Updating ranking configuration...',
      async () => {
        setError('');
        try {
          const r = await window.rovdo!.intelligenceCommand(input);
          if (!r.ok) {
            setError(importFailureMessage(r.code));
            return;
          }
          setView(r.view);
          const created =
            input.op === 'cloneRanking'
              ? r.view.rankings.find((p) => !view?.rankings.some((old) => old.id === p.id))
              : undefined;
          const current =
            created ??
            r.view.rankings.find((p) => p.id === rankingId) ??
            r.view.rankings.find((p) => p.id === r.view.defaultRanking)!;
          setRankingId(current.id);
          setRanking(editable(current));
          if (created) {
            setManageOpen(true);
            setConfigureOpen(true);
          }
          if (
            ['paste', 'github', 'importFile', 'importTranscript', 'assistImport'].includes(input.op)
          ) {
            const next = r.view.previews.find((p) => p.status === 'ready');
            setDraft(next ?? null);
          }
          if (input.op === 'applyImport' || input.op === 'rejectImport') {
            setDraft(null);
          }
          if (
            input.op === 'applyImport' ||
            input.op === 'defaultRanking' ||
            input.op === 'saveRanking' ||
            input.op === 'resetRanking' ||
            input.op === 'deleteRanking'
          )
            onChanged(r.view.profile);
        } catch {
          setError('Invalid input or desktop unavailable. Your saved information is unchanged.');
        }
      },
    );
  }
  useEffect(() => {
    if (rankingId) onSelected?.(rankingId);
  }, [rankingId, onSelected]);
  function cloneRanking(id: string) {
    const base = view?.rankings.find((p) => p.id === id);
    if (!base) return;
    let number = 1;
    let name: string;
    do {
      const suffix = number === 1 ? '_clone' : `_clone_${number}`;
      name = `${base.name.slice(0, 100 - suffix.length)}${suffix}`;
      number++;
    } while (view!.rankings.some((p) => p.name === name));
    void command({ op: 'cloneRanking', id, name });
  }
  function selectRanking(id: string) {
    setRankingId(id);
    const selected = view?.rankings.find((p) => p.id === id);
    setRanking(selected ? editable(selected) : null);
    setError('');
  }
  return (
    <section
      className="intelligence-panel"
      aria-label={tab === 'profile' ? 'Profile intelligence' : 'Ranking configurations'}
    >
      {error && <p role="alert">{error}</p>}
      <OperationStatus label={actionLabel} />
      <fieldset className="action-surface" disabled={busy} aria-busy={busy}>
        {tab === 'profile' ? (
          <>
            <h2>Imports &amp; verification</h2>
            <p>
              Local, deterministic extraction. Nothing affects matching until you review and confirm
              it.
            </p>
            {!draft && (
              <>
                <ol className="import-steps" aria-label="Import progress">
                  <li aria-current="step">1. Select source</li>
                  <li>2. Extract</li>
                  <li>3. Review</li>
                  <li>4. Confirm</li>
                </ol>
                <h3>Import qualifications</h3>
                <p>
                  Review proposed facts before they affect matching. Documents stay local. GitHub
                  imports read public repositories; LinkedIn accepts only your archive or pasted
                  content.
                </p>
                <div className="button-row">
                  <button disabled={busy} onClick={() => void command({ op: 'importFile' })}>
                    Choose profile file
                  </button>
                  <button disabled={busy} onClick={() => void command({ op: 'importTranscript' })}>
                    Import academic transcript
                  </button>
                  <span>PDF, DOCX, TXT, Markdown, JSON or LinkedIn archive ZIP · up to 5 MB</span>
                </div>
                <details>
                  <summary>Paste a profile</summary>
                  <label>
                    Content source
                    <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                      <option value="linkedin">My LinkedIn profile</option>
                      <option value="file">Resume or profile text</option>
                    </select>
                  </label>
                  <label>
                    Pasted profile content
                    <textarea rows={7} value={paste} onChange={(e) => setPaste(e.target.value)} />
                  </label>
                  <button
                    disabled={busy || !paste.trim()}
                    onClick={() => void command({ op: 'paste', text: paste, kind })}
                  >
                    Preview pasted profile
                  </button>
                </details>
                <details>
                  <summary>Import public GitHub projects</summary>
                  <label>
                    GitHub username
                    <input
                      value={github}
                      onChange={(e) => {
                        setGithub(e.target.value);
                        setGithubConsent(false);
                      }}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={githubConsent}
                      onChange={(e) => setGithubConsent(e.target.checked)}
                    />
                    I approve reading up to 10 public repositories, languages and README files from
                    api.github.com
                  </label>
                  <button
                    disabled={busy || !github || !githubConsent}
                    onClick={() =>
                      void command({ op: 'github', username: github, limit: 10, consent: true })
                    }
                  >
                    Preview GitHub projects
                  </button>
                </details>
              </>
            )}
            {!draft &&
              view?.previews
                .filter((p) => p.status === 'ready')
                .map((p) => (
                  <button type="button" key={p.id} onClick={() => setDraft(p)}>
                    Review {p.source.name}
                  </button>
                ))}
            {draft && (
              <ImportReview
                key={draft.id}
                draft={draft}
                profile={view?.profile ?? null}
                assistance={
                  <ImportAssistance
                    preview={view?.previews.find((p) => p.id === draft.id) ?? draft}
                    settings={settings}
                    onImprove={(request) =>
                      void command({ op: 'assistImport', id: draft.id, ...request })
                    }
                  />
                }
                onChange={setDraft}
                onReject={() => void command({ op: 'rejectImport', id: draft.id })}
                onApply={(selectedIds, confirmSensitive, reviewedCriticalIds) => {
                  const parsed = IntelligenceSchema.safeParse(draft.intelligence);
                  if (!parsed.success) {
                    setError('Check dates, skill names and evidence before merging.');
                    return;
                  }
                  void command({
                    op: 'applyImport',
                    id: draft.id,
                    intelligence: parsed.data,
                    facts: draft.facts,
                    selectedIds,
                    confirmSensitive,
                    reviewedCriticalIds,
                  });
                }}
              />
            )}
            {view?.profile?.intelligence && (
              <details>
                <summary>Verified structured qualifications</summary>
                <p>
                  {view.profile.intelligence.skills.filter((s) => s.verified).length} verified
                  skills · {view.profile.intelligence.experience.filter((s) => s.verified).length}
                  {' verified employment records'}
                </p>
              </details>
            )}
          </>
        ) : (
          <>
            <h2>Ranking method</h2>
            <div className="ranking-toolbar">
              <label>
                Ranking preset
                <select value={rankingId} onChange={(e) => selectRanking(e.target.value)}>
                  {view?.rankings.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {ranking && (
                <>
                  <button
                    disabled={busy || view?.defaultRanking === ranking.id}
                    onClick={() => void command({ op: 'defaultRanking', id: ranking.id })}
                  >
                    Use as default ranking
                  </button>
                  <button disabled={busy} onClick={() => cloneRanking(ranking.id)}>
                    Clone selected ranking
                  </button>
                </>
              )}
            </div>
            <p className="help-text">
              Default: {view?.rankings.find((p) => p.id === view.defaultRanking)?.name}
            </p>
            {ranking && (
              <>
                <details open={manageOpen} onToggle={(e) => setManageOpen(e.currentTarget.open)}>
                  <summary>Manage ranking profiles</summary>
                  <p className="help-text">
                    Technical methods score verified qualifications. Opportunity Hybrid also
                    includes preferences. Clone a preset to customize it.
                  </p>
                  <RankingEditor
                    open={configureOpen}
                    onToggle={setConfigureOpen}
                    ranking={ranking}
                    busy={busy}
                    onChange={setRanking}
                    onSave={() => {
                      if (totalWeight(ranking.weights) !== 100) {
                        setError('Weights must total 100 before saving.');
                        return;
                      }
                      const parsed = RankingProfileSchema.safeParse({
                        ...ranking,
                        revision: ranking.revision + 1,
                      });
                      if (!parsed.success) {
                        setError(
                          'Invalid configuration: check weights, multipliers and thresholds.',
                        );
                        return;
                      }
                      void command({ op: 'saveRanking', profile: parsed.data });
                    }}
                  />
                  {!ranking.id.startsWith('builtin:') && (
                    <button
                      disabled={busy}
                      onClick={() => void command({ op: 'deleteRanking', id: ranking.id })}
                    >
                      Delete custom ranking
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => setTransfer(JSON.stringify(ranking, null, 2))}
                  >
                    Export selected configuration
                  </button>
                  {!ranking.id.startsWith('builtin:') && (
                    <>
                      <label>
                        Reset from preset
                        <select
                          value={resetPreset}
                          onChange={(e) => setResetPreset(e.target.value)}
                        >
                          {view?.rankings
                            .filter((p) => p.id.startsWith('builtin:'))
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void command({
                            op: 'resetRanking',
                            id: ranking.id,
                            presetId: resetPreset,
                          })
                        }
                      >
                        Reset custom configuration to preset
                      </button>
                    </>
                  )}
                  <details open={!!transfer}>
                    <summary>Import or export ranking JSON</summary>
                    <p>
                      Copy the JSON to export. Imported configurations always create a new local
                      identity and never overwrite a saved profile.
                    </p>
                    <label>
                      Ranking configuration JSON
                      <textarea
                        rows={8}
                        value={transfer}
                        onChange={(e) => setTransfer(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !transfer.trim()}
                      onClick={() => void command({ op: 'importRanking', json: transfer })}
                    >
                      Import as new configuration
                    </button>
                  </details>
                  <button
                    disabled={busy}
                    onClick={() => cloneRanking('builtin:technical-balanced')}
                  >
                    Create technical ranking
                  </button>
                </details>
              </>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
