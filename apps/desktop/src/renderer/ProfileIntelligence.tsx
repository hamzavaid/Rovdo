import { OperationStatus } from './OperationStatus';
import { useActionState } from './action-state';
import { useEffect, useState } from 'react';
import { RankingEditor } from './RankingEditor';
import { editorWeights, totalWeight } from './ranking-weights';
import { IntelligenceSchema, RankingProfileSchema } from '@rovdo/shared';
import type { CandidateProfile, ImportPreview, Intelligence, IntelligenceCommand, IntelligenceView, RankingProfile } from '@rovdo/shared';

const sections = ['skills', 'education', 'experience', 'projects', 'certifications'] as const;
const singular = { skills: 'skill', education: 'education', experience: 'experience', projects: 'project', certifications: 'certification' };
const choices: Record<string, string[]> = { depth: ['production', 'project', 'supporting', 'course', 'declared'], status: ['completed', 'enrolled', 'expected', 'incomplete'], level: ['high-school', 'associate', 'bachelor', 'master', 'doctorate', 'other'], track: ['ic', 'management', 'unknown'] };
const editable = (p: RankingProfile) => p.id.startsWith('builtin:') ? p : { ...p, weights: editorWeights(p.weights) };
const idsOf = (intel: Intelligence) => sections.flatMap((key) => intel[key].map((x) => x.id));

export function ProfileIntelligence({ tab, onChanged, onSelected }: { onSelected?: (id: string) => void; tab: 'profile' | 'jobs'; onChanged: (profile: CandidateProfile | null) => void }) {
  const [view, setView] = useState<IntelligenceView | null>(null);
  const [error, setError] = useState(''); const { pending: busy, label: actionLabel, run } = useActionState(); const [reviewSkill, setReviewSkill] = useState('');
  const [paste, setPaste] = useState(''); const [kind, setKind] = useState<'file' | 'linkedin'>('linkedin');
  const [github, setGithub] = useState(''); const [githubConsent, setGithubConsent] = useState(false);
  const [draft, setDraft] = useState<ImportPreview | null>(null); const [selected, setSelected] = useState<string[]>([]); const [legal, setLegal] = useState(false);
  const [rankingId, setRankingId] = useState(''); const [ranking, setRanking] = useState<RankingProfile | null>(null); const [transfer, setTransfer] = useState(''); const [resetPreset, setResetPreset] = useState('builtin:technical-balanced');
  const [manageOpen, setManageOpen] = useState(false); const [configureOpen, setConfigureOpen] = useState(false);
  useEffect(() => { void window.rovdo!.intelligenceCommand({ op: 'view' }).then((r) => { if (r.ok) { setView(r.view); setRankingId(r.view.defaultRanking); setRanking(editable(r.view.rankings.find((p) => p.id === r.view.defaultRanking)!)); } else setError(r.code); }).catch(() => setError('Desktop unavailable')); }, []);
  async function command(input: IntelligenceCommand) {
    await run(['paste', 'github', 'importFile'].includes(input.op) ? 'Preparing import preview...' : input.op === 'applyImport' ? 'Verifying and merging qualifications...' : 'Updating ranking configuration...', async () => {
    setError('');
    try {
      const r = await window.rovdo!.intelligenceCommand(input); if (!r.ok) { setError(`${r.code}: check your input or try again.`); return; }
      setView(r.view);
      const created = input.op === 'cloneRanking' ? r.view.rankings.find((p) => !view?.rankings.some((old) => old.id === p.id)) : undefined;
      const current = created ?? r.view.rankings.find((p) => p.id === rankingId) ?? r.view.rankings.find((p) => p.id === r.view.defaultRanking)!;
      setRankingId(current.id); setRanking(editable(current));
      if (created) { setManageOpen(true); setConfigureOpen(true); }
      if (['paste', 'github', 'importFile'].includes(input.op)) { const next = r.view.previews.find((p) => p.status === 'ready'); setDraft(next ?? null); setSelected([]); setReviewSkill(''); setLegal(false); }
      if (input.op === 'applyImport' || input.op === 'rejectImport') { setDraft(null); setSelected([]); }
      if (input.op === 'applyImport' || input.op === 'defaultRanking' || input.op === 'saveRanking' || input.op === 'resetRanking' || input.op === 'deleteRanking') onChanged(r.view.profile);
    } catch { setError('Invalid input or desktop unavailable. Your saved information is unchanged.'); }
    });
  }
  useEffect(() => { if (rankingId) onSelected?.(rankingId); }, [rankingId, onSelected]);
  function cloneRanking(id: string) {
    const base = view?.rankings.find((p) => p.id === id); if (!base) return;
    let number = 1; let name: string;
    do { const suffix = number === 1 ? '_clone' : `_clone_${number}`; name = `${base.name.slice(0, 100 - suffix.length)}${suffix}`; number++; }
    while (view!.rankings.some((p) => p.name === name));
    void command({ op: 'cloneRanking', id, name });
  }
  function selectRanking(id: string) { setRankingId(id); const selected = view?.rankings.find((p) => p.id === id); setRanking(selected ? editable(selected) : null); setError(''); }
  function changeItem(key: typeof sections[number], id: string, field: string, value: unknown) {
    if (!draft) return;
    setDraft({ ...draft, intelligence: { ...draft.intelligence, [key]: draft.intelligence[key].map((x) => x.id === id ? { ...x, [field]: value, verified: false } : x) } });
  }
  return <section className="intelligence-panel" aria-label={tab === 'profile' ? 'Profile intelligence' : 'Ranking configurations'}>
    {error && <p role="alert">{error}</p>}
    <OperationStatus label={actionLabel} />
    <fieldset className="action-surface" disabled={busy} aria-busy={busy}>
    {tab === 'profile' ? <>
      <h2>Imports &amp; verification</h2><p>1. Import a source. 2. Review the proposed qualifications. 3. Verify only facts you can support.</p><h3>Import qualifications</h3><p>Review proposed facts before they affect matching. Documents stay local. GitHub imports read public repositories; LinkedIn accepts only your archive or pasted content.</p>
      <div className="button-row"><button disabled={busy} onClick={() => void command({ op: 'importFile' })}>Choose profile file</button><span>PDF, DOCX, TXT, Markdown, JSON or LinkedIn archive ZIP · up to 5 MB</span></div>
      <details><summary>Paste a profile</summary><label>Content source<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="linkedin">My LinkedIn profile</option><option value="file">Resume or profile text</option></select></label><label>Pasted profile content<textarea rows={7} value={paste} onChange={(e) => setPaste(e.target.value)} /></label><button disabled={busy || !paste.trim()} onClick={() => void command({ op: 'paste', text: paste, kind })}>Preview pasted profile</button></details>
      <details><summary>Import public GitHub projects</summary><label>GitHub username<input value={github} onChange={(e) => { setGithub(e.target.value); setGithubConsent(false); }} /></label><label><input type="checkbox" checked={githubConsent} onChange={(e) => setGithubConsent(e.target.checked)} />I approve reading up to 10 public repositories, languages and README files from api.github.com</label><button disabled={busy || !github || !githubConsent} onClick={() => void command({ op: 'github', username: github, limit: 10, consent: true })}>Preview GitHub projects</button></details>
      {!draft && view?.previews.filter((p) => p.status === 'ready').map((p) => <button key={p.id} onClick={() => { setDraft(p); setSelected([]); setLegal(false); }}>Review {p.source.name}</button>)}
      {draft && <div className="import-preview"><h3>Review import</h3><p>{draft.source.name} · {draft.source.kind} · {draft.parserVersion}</p><small>Source SHA-256: {draft.source.sha256}</small>{draft.warnings.map((w) => <p key={w} className="help-text">{w}</p>)}
        <div className="button-row"><button onClick={() => setSelected(idsOf(draft.intelligence))}>Select all qualifications</button><button onClick={() => setSelected([])}>Clear selection</button></div>
        {sections.map((key) => <div key={key}><h4>{key}</h4>{key === 'skills' && <><p className="help-text">{draft.intelligence.skills.filter((s) => selected.includes(s.id)).length} selected for verification. Nothing is verified until you merge.</p><div className="skill-chips">{draft.intelligence.skills.map((s) => <button type="button" className="skill-chip" key={s.id} aria-label={`Review ${s.skillId} imported skill`} aria-pressed={reviewSkill === s.id} onClick={() => setReviewSkill(reviewSkill === s.id ? '' : s.id)}><span aria-hidden="true">{selected.includes(s.id) ? '\u2713' : '\u25cb'}</span>{s.skillId}</button>)}</div></>}{draft.intelligence[key].map((item, i) => key === 'skills' && reviewSkill !== item.id ? null : <article className="qualification" key={item.id}>
          <label><input type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />Verify {singular[key]} {i + 1}</label>
          <div className="career-fields">{Object.entries(item).filter(([field]) => !['id', 'evidenceIds', 'verified', 'metadata'].includes(field)).map(([field, value]) => {
            const label = `Review ${singular[key]} ${i + 1} ${field}`;
            const options = field === 'level' && key === 'experience' ? ['unknown', 'intern', 'entry', 'junior', 'mid', 'senior', 'staff', 'principal', 'lead'] : choices[field];
            return <label key={field}>{field}{typeof value === 'boolean' ? <input aria-label={label} type="checkbox" checked={value} onChange={(e) => changeItem(key, item.id, field, e.target.checked)} /> : options ? <select aria-label={label} value={String(value ?? '')} onChange={(e) => changeItem(key, item.id, field, e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select> : <input aria-label={label} value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} onChange={(e) => changeItem(key, item.id, field, Array.isArray(value) ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : e.target.value || (['version', 'start', 'end', 'graduation', 'expires', 'url'].includes(field) ? null : ''))} />}</label>;
          })}</div>
          <details><summary>Supporting source evidence</summary>{item.evidenceIds.map((id) => { const e = draft.intelligence.evidence.find((e) => e.id === id); return e ? <blockquote key={id}>{e.excerpt}<small> · extraction confidence {Math.round(e.confidence * 100)}%</small></blockquote> : null; })}{'metadata' in item && <pre>{JSON.stringify(item.metadata, null, 2)}</pre>}</details>
        </article>)}</div>)}
        {draft.facts.map((f) => <label key={f.id}><input type="checkbox" checked={selected.includes(f.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, f.id] : selected.filter((id) => id !== f.id))} />Include {f.field}: {f.value}</label>)}
        <label><input type="checkbox" checked={legal} onChange={(e) => setLegal(e.target.checked)} />I explicitly confirm selected citizenship, work authorization and clearance assertions as my own</label>
        <div className="button-row"><button disabled={busy || !selected.length} className="primary-button" onClick={() => { const parsed = IntelligenceSchema.safeParse(draft.intelligence); if (!parsed.success) { setError('Check canonical skill IDs, dates, evidence and required fields.'); return; } void command({ op: 'applyImport', id: draft.id, intelligence: parsed.data, facts: draft.facts, selectedIds: selected, confirmSensitive: legal }); }}>Verify selected and merge</button><button disabled={busy} onClick={() => void command({ op: 'rejectImport', id: draft.id })}>Reject import</button></div>
      </div>}
      {view?.profile?.intelligence && <details><summary>Verified structured qualifications</summary><p>{view.profile.intelligence.skills.filter((s) => s.verified).length} verified skills · {view.profile.intelligence.experience.filter((s) => s.verified).length} verified employment records</p><pre>{JSON.stringify(view.profile.intelligence, null, 2)}</pre></details>}
    </> : <>
      <h2>Ranking method</h2>
      <div className="ranking-toolbar"><label>Ranking preset<select value={rankingId} onChange={(e) => selectRanking(e.target.value)}>{view?.rankings.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {ranking && <><button disabled={busy || view?.defaultRanking === ranking.id} onClick={() => void command({ op: 'defaultRanking', id: ranking.id })}>Use as default ranking</button><button disabled={busy} onClick={() => cloneRanking(ranking.id)}>Clone selected ranking</button></>}</div>
      <p className="help-text">Default: {view?.rankings.find((p) => p.id === view.defaultRanking)?.name}</p>
      {ranking && <>
        <details open={manageOpen} onToggle={(e) => setManageOpen(e.currentTarget.open)}><summary>Manage ranking profiles</summary><p className="help-text">Technical methods score verified qualifications. Opportunity Hybrid also includes preferences. Clone a preset to customize it.</p><RankingEditor open={configureOpen} onToggle={setConfigureOpen} ranking={ranking} busy={busy} onChange={setRanking} onSave={() => {
          if (totalWeight(ranking.weights) !== 100) { setError('Weights must total 100 before saving.'); return; }
          const parsed = RankingProfileSchema.safeParse({ ...ranking, revision: ranking.revision + 1 });
          if (!parsed.success) { setError('Invalid configuration: check weights, multipliers and thresholds.'); return; }
          void command({ op: 'saveRanking', profile: parsed.data });
        }} />
        {!ranking.id.startsWith('builtin:') && <button disabled={busy} onClick={() => void command({ op: 'deleteRanking', id: ranking.id })}>Delete custom ranking</button>}
        <button disabled={busy} onClick={() => setTransfer(JSON.stringify(ranking, null, 2))}>Export selected configuration</button>
        {!ranking.id.startsWith('builtin:') && <><label>Reset from preset<select value={resetPreset} onChange={(e) => setResetPreset(e.target.value)}>{view?.rankings.filter((p) => p.id.startsWith('builtin:')).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={busy} onClick={() => void command({ op: 'resetRanking', id: ranking.id, presetId: resetPreset })}>Reset custom configuration to preset</button></>}
        <details open={!!transfer}><summary>Import or export ranking JSON</summary><p>Copy the JSON to export. Imported configurations always create a new local identity and never overwrite a saved profile.</p><label>Ranking configuration JSON<textarea rows={8} value={transfer} onChange={(e) => setTransfer(e.target.value)} /></label><button disabled={busy || !transfer.trim()} onClick={() => void command({ op: 'importRanking', json: transfer })}>Import as new configuration</button></details>
        <button disabled={busy} onClick={() => cloneRanking('builtin:technical-balanced')}>Create technical ranking</button></details>
      </>}
    </>}
    </fieldset>
  </section>;
}
