/** Saved methods keep stable identities; preview uses the actual scorer without saving a draft. */
import { useEffect, useState } from 'react';
import type {
  CareerViewSchema,
  IntelligenceCommand,
  IntelligenceView,
  JobMatch,
  RankingProfile,
} from '@rovdo/shared';
import type { z } from 'zod';
import { RankingEditor } from './RankingEditor';
import { editorWeights, totalWeight } from './ranking-weights';
import { ProfileDialog } from './ProfileDialog';
import { rankingLabel } from './jobs-state';
export function JobsRanking({
  view,
  onChanged,
}: {
  view: z.infer<typeof CareerViewSchema> | null;
  onChanged: () => void;
}) {
  const [data, setData] = useState<IntelligenceView | null>(null),
    [draft, setDraft] = useState<RankingProfile | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [transfer, setTransfer] = useState<string | null>(null),
    [compare, setCompare] = useState(false),
    [selected, setSelected] = useState<string[]>([
      'builtin:legacy-v1',
      'builtin:technical-balanced',
    ]),
    [scores, setScores] = useState<JobMatch[]>([]),
    [preview, setPreview] = useState<{ before: number; after: number } | null>(null),
    [job, setJob] = useState(''),
    [reset, setReset] = useState('builtin:technical-balanced');
  const editable = (p: RankingProfile) =>
    p.id.startsWith('builtin:')
      ? structuredClone(p)
      : { ...structuredClone(p), weights: editorWeights(p.weights) };
  useEffect(() => {
    let stale = false;
    void window.rovdo!.intelligenceCommand({ op: 'view' }).then((r) => {
      if (!stale && r.ok) {
        setData(r.view);
        setDraft(editable(r.view.rankings.find((p) => p.id === r.view.defaultRanking)!));
      }
    });
    return () => {
      stale = true;
    };
  }, []);
  async function command(cmd: IntelligenceCommand) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await window.rovdo!.intelligenceCommand(cmd);
      if (!r.ok) {
        setError(r.code);
        return;
      }
      const created =
        cmd.op === 'cloneRanking' || cmd.op === 'importRanking'
          ? r.view.rankings.find((p) => !data?.rankings.some((old) => old.id === p.id))
          : undefined;
      setData(r.view);
      const current =
        created ??
        r.view.rankings.find((p) => p.id === draft?.id) ??
        r.view.rankings.find((p) => p.id === r.view.defaultRanking)!;
      setDraft(editable(current));
      onChanged();
    } catch {
      setError('Unable to update ranking configuration');
    } finally {
      setBusy(false);
    }
  }
  const [choices, setChoices] = useState<NonNullable<typeof view>['rankingJobs']>(undefined);
  const [choiceQuery, setChoiceQuery] = useState(''),
    [choiceOffset, setChoiceOffset] = useState(0),
    [choiceTotal, setChoiceTotal] = useState(0);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      void window
        .rovdo!.careerCommand({ op: 'rankingJobs', query: choiceQuery, offset: choiceOffset })
        .then((r) => {
          if (!stale && r.ok) {
            setChoices(r.view.rankingJobs);
            setChoiceTotal(r.view.rankingJobTotal ?? 0);
          }
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [choiceQuery, choiceOffset]);
  const available = choices ?? view?.rankingJobs ?? [];
  const jobId = job || available[0]?.id || '';
  useEffect(() => {
    if (!jobId || !draft || !data) return;
    let stale = false;
    setPreview(null);
    const timer = setTimeout(() => {
      void Promise.all([
        window.rovdo!.careerCommand({ op: 'previewRanking', jobId, config: draft }),
        window.rovdo!.careerCommand({
          op: 'compare',
          jobId,
          rankingIds: [
            ...new Set([
              data.defaultRanking,
              data.defaultRanking === 'builtin:legacy-v1'
                ? 'builtin:technical-balanced'
                : 'builtin:legacy-v1',
            ]),
          ],
        }),
      ])
        .then(([a, b]) => {
          if (!stale && a.ok && b.ok)
            setPreview({
              after: a.view.comparisons[0]!.score,
              before: b.view.comparisons.find((m) => m.ranking?.configId === data.defaultRanking)!
                .score,
            });
        })
        .catch(() => {
          if (!stale) setError('Preview unavailable: check draft configuration');
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [jobId, draft, data]);
  function clone(id: string) {
    const p = data?.rankings.find((r) => r.id === id);
    if (!p) return;
    let name = `${p.name}_clone`,
      n = 2;
    while (data!.rankings.some((r) => r.name === name)) name = `${p.name}_clone${n++}`;
    void command({ op: 'cloneRanking', id, name });
  }
  return (
    <section className="jobs-page">
      <div className="jobs-row">
        <div>
          <h1>Ranking Methods</h1>
          <p>
            Explainable qualification scores are separate from eligibility and hiring probability.
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => setTransfer(draft ? JSON.stringify(draft, null, 2) : '')}>
            Import / Export JSON
          </button>
          <button disabled={!jobId} onClick={() => setCompare(true)}>
            Compare methods
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="jobs-ranking-grid">
        <aside className="surface-card">
          <h2>Available methods</h2>
          <div className="ranking-method-list">
            {data?.rankings.map((r) => (
              <button
                aria-pressed={draft?.id === r.id}
                key={r.id}
                onClick={() => setDraft(editable(r))}
              >
                <strong>{rankingLabel(r)}</strong>
                <small>
                  {r.name}
                  {r.id === data.defaultRanking ? ' · Default' : ''}
                </small>
              </button>
            ))}
          </div>
          <button disabled={busy} onClick={() => clone('builtin:technical-balanced')}>
            + Create custom method
          </button>
        </aside>
        <div className="surface-card">
          {draft && (
            <>
              <h2>{rankingLabel(draft)}</h2>
              <p className="help-text">
                {draft.id.startsWith('builtin:')
                  ? 'Immutable built-in preset'
                  : 'Custom configuration'}{' '}
                · Revision {draft.revision}
              </p>
              <div className="button-row">
                <button
                  disabled={busy || data?.defaultRanking === draft.id}
                  onClick={() => void command({ op: 'defaultRanking', id: draft.id })}
                >
                  Use as default ranking
                </button>
                <button disabled={busy} onClick={() => clone(draft.id)}>
                  Clone selected ranking
                </button>
              </div>
              <RankingEditor
                ranking={draft}
                busy={busy}
                open={true}
                onToggle={() => {}}
                onChange={setDraft}
                onSave={() => {
                  if (totalWeight(draft.weights) !== 100) {
                    setError('Weights must total 100 before saving.');
                    return;
                  }
                  void command({
                    op: 'saveRanking',
                    profile: { ...draft, revision: draft.revision + 1 },
                  });
                }}
              />
              {!draft.id.startsWith('builtin:') && (
                <details>
                  <summary>Reset or delete custom method</summary>
                  <label>
                    Reset from preset
                    <select value={reset} onChange={(e) => setReset(e.target.value)}>
                      {data?.rankings
                        .filter((r) => r.id.startsWith('builtin:'))
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {rankingLabel(r)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void command({ op: 'resetRanking', id: draft.id, presetId: reset })
                    }
                  >
                    Reset custom configuration to preset
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void command({ op: 'deleteRanking', id: draft.id })}
                  >
                    Delete custom ranking
                  </button>
                </details>
              )}
              <section className="ranking-preview-results">
                <h3>Before / After preview</h3>
                <p className="help-text">
                  Real indexed job and verified evidence. Unsaved drafts do not change your default.
                </p>
                <label>
                  Find a preview job
                  <input
                    value={choiceQuery}
                    onChange={(e) => {
                      setChoiceQuery(e.target.value);
                      setChoiceOffset(0);
                      setJob('');
                    }}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={choiceOffset === 0}
                    onClick={() => {
                      setChoiceOffset(Math.max(0, choiceOffset - 50));
                      setJob('');
                    }}
                  >
                    Previous jobs
                  </button>
                  <span>{choiceTotal} indexed jobs</span>
                  <button
                    disabled={choiceOffset + 50 >= choiceTotal}
                    onClick={() => {
                      setChoiceOffset(choiceOffset + 50);
                      setJob('');
                    }}
                  >
                    More jobs
                  </button>
                </div>
                <label>
                  Preview job
                  <select value={jobId} onChange={(e) => setJob(e.target.value)}>
                    {available.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.company} / {m.title}
                      </option>
                    ))}
                  </select>
                </label>
                {!jobId ? (
                  <p>No indexed jobs are available. Search for jobs first.</p>
                ) : (
                  <div className="company-metrics">
                    <div>
                      <small>Current default</small>
                      <strong>{preview ? preview.before.toFixed(1) : '…'} / 100</strong>
                    </div>
                    <div>
                      <small>Selected / proposed method</small>
                      <strong>{preview ? preview.after.toFixed(1) : '…'} / 100</strong>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {transfer !== null && (
        <ProfileDialog title="Import / Export JSON" onClose={() => setTransfer(null)}>
          <p>
            Export by copying the configuration. Import creates a new identity and never overwrites
            a saved method.
          </p>
          <label>
            Ranking configuration JSON
            <textarea
              rows={12}
              maxLength={20000}
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
        </ProfileDialog>
      )}
      {compare && (
        <ProfileDialog title="Compare ranking methods" onClose={() => setCompare(false)}>
          <label>
            Comparison job
            <select value={jobId} onChange={(e) => setJob(e.target.value)}>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.company} / {m.title}
                </option>
              ))}
            </select>
          </label>
          {data?.rankings.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id),
                  )
                }
              />
              {rankingLabel(r)}
            </label>
          ))}
          <button
            disabled={selected.length < 2 || selected.length > 5 || !jobId}
            onClick={() =>
              void window
                .rovdo!.careerCommand({ op: 'compare', jobId, rankingIds: selected })
                .then((r) => {
                  if (r.ok) setScores(r.view.comparisons);
                  else setError(r.code);
                })
            }
          >
            Calculate comparison
          </button>
          {scores.map((m) => (
            <p key={m.ranking?.configId}>
              {rankingLabel({
                id: m.ranking!.configId,
                name: data?.rankings.find((r) => r.id === m.ranking!.configId)?.name ?? '',
              })}
              : {m.score.toFixed(1)} / 100 · confidence {Math.round(m.confidence * 100)}% · coverage{' '}
              {Math.round((m.ranking?.requiredCoverage ?? 0) * 100)}% ·{' '}
              {m.excluded ? 'Excluded' : m.review ? 'Needs review' : 'Assessed'}
            </p>
          ))}
        </ProfileDialog>
      )}
    </section>
  );
}
