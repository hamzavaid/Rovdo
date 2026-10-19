import { useState } from 'react';
import type { RankingProfile } from '@rovdo/shared';
import { balanceWeight, editorWeights, setWeight, totalWeight } from './ranking-weights';

const allowed = { 'technical-v2': ['skills', 'experience', 'projects', 'seniority', 'role', 'depth', 'education', 'lexical'], 'opportunity-v2': ['skills', 'role', 'experience', 'location', 'salary', 'education', 'lexical', 'company'], 'legacy-v1': ['skills', 'role', 'location', 'eligibility', 'preferences'] };
const thresholds = {
  score: 'Minimum score needed to mark a job as shortlisted (0-100).',
  confidence: 'Minimum confidence in the supporting evidence for a shortlist (0-100%).',
  coverage: 'Minimum share of required skills supported by evidence (0-100%). Also used by the required-skills gate.',
};
const gates = {
  education: 'Enforce published education requirements. Missing evidence remains unknown and needs review.',
  location: 'Enforce your preferred locations and work modes when the job provides that information.',
  salary: 'Enforce your minimum salary when comparable compensation is published; missing pay needs review.',
  requiredSkills: 'Flag jobs below the required-skill coverage threshold for review; missing evidence is not an automatic failure.',
  experience: 'Enforce required relevant experience. Insufficient verified duration can fail; incomplete dates need review.',
};
const percent = (value: number) => Number((value * 100).toFixed(6));
const labels = { requiredMultiplier: 'Required requirement multiplier', preferredMultiplier: 'Preferred requirement multiplier', minimumEvidence: 'Minimum evidence confidence', implicationCredit: 'Curated transferable skill credit' };
export function RankingEditor({ ranking, busy, onChange, onSave, open, onToggle }: { open: boolean; onToggle: (open: boolean) => void; ranking: RankingProfile; busy: boolean; onChange: (r: RankingProfile) => void; onSave: () => void }) {
  const [autoBalance, setAutoBalance] = useState(false);
  const builtin = ranking.id.startsWith('builtin:');
  const weights = builtin ? editorWeights(ranking.weights) : ranking.weights;
  const total = totalWeight(weights);
  return <details className="ranking-editor" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}><summary>Configure selected ranking</summary>
    <p className="help-text">{ranking.method} / revision {ranking.revision}. Weights are percentages. Reduce one weight to free room for another. Missing job criteria remain inactive during scoring.</p>
    {builtin && <p className="help-text">This preset is read-only. Clone it to customize. Percentage display preserves the original preset.</p>}
    <fieldset disabled={builtin || busy}>
      <label>Ranking name<input value={ranking.name} maxLength={100} onChange={(e) => onChange({ ...ranking, name: e.target.value })} /></label>
      <div className="weight-heading"><h3>Component weights</h3><output aria-live="polite">Total weight: {total} / 100</output></div>
      <div className="button-row"><label><input type="checkbox" checked={autoBalance} onChange={(e) => { setAutoBalance(e.target.checked); if (e.target.checked) onChange({ ...ranking, weights: editorWeights(weights) }); }} />Auto-balance weights</label><button type="button" onClick={() => onChange({ ...ranking, weights: editorWeights(weights) })}>Normalize to 100%</button></div><p className="help-text">Auto-balance redistributes the remaining percentage across other components. Manual mode keeps the 100-point cap.</p><div className="weight-grid">{Object.entries(weights).filter(([key]) => allowed[ranking.method].includes(key)).map(([key, value]) => <div className="weight-control" key={key}>
        <label htmlFor={`weight-${key}`}>{key === 'depth' ? 'Stack depth' : key === 'lexical' ? 'Lexical evidence' : key}</label>
        <input id={`weight-${key}`} aria-label={`${key} weight slider`} type="range" min="0" max="100" step="0.1" value={value} onChange={(e) => onChange({ ...ranking, weights: autoBalance ? balanceWeight(weights, key as keyof typeof weights, Number(e.target.value), allowed[ranking.method]) : setWeight(weights, key as keyof typeof weights, Number(e.target.value)) })} />
        <input aria-label={`${key} weight`} type="number" min="0" max="100" step="0.1" value={value} onChange={(e) => onChange({ ...ranking, weights: autoBalance ? balanceWeight(weights, key as keyof typeof weights, Number(e.target.value), allowed[ranking.method]) : setWeight(weights, key as keyof typeof weights, Number(e.target.value)) })} />
      </div>)}</div>
      <details className="weight-preview"><summary>Allocation preview</summary><p className="help-text">Automatic normalization of this draft. Actual job scores also depend on evidence and active job criteria.</p>{Object.entries(editorWeights(weights)).filter(([key]) => allowed[ranking.method].includes(key)).map(([key, value]) => <div key={key}><span>{key}</span><meter min="0" max="100" value={value} aria-label={`${key} normalized allocation`} /><strong>{value}%</strong></div>)}</details><h3>Shortlist thresholds</h3><div className="career-fields">{(['score', 'confidence', 'coverage'] as const).map((key) => <label key={key}>{key} threshold{key === 'score' ? '' : ' (%)'}<input type="number" min="0" max={100} step="any" value={key === 'score' ? ranking.thresholds[key] : percent(ranking.thresholds[key])} aria-label={`${key} threshold`} aria-describedby={`threshold-${key}`} onChange={(e) => onChange({ ...ranking, thresholds: { ...ranking.thresholds, [key]: Number(e.target.value) / (key === 'score' ? 1 : 100) } })} /><small id={`threshold-${key}`} className="help-text">{thresholds[key]}</small></label>)}</div>
      <h3>Eligibility gates</h3><p className="help-text">These constraints are separate from score weights. Legal restrictions always apply. Unknown information stays flagged for review.</p>
      <div className="gate-grid">{(['education', 'location', 'salary', 'requiredSkills', 'experience'] as const).map((key) => <div className="gate-control" key={key}><label><input type="checkbox" checked={ranking.gates[key]} aria-describedby={`gate-${key}`} onChange={(e) => onChange({ ...ranking, gates: { ...ranking.gates, [key]: e.target.checked } })} />Enforce {key === 'requiredSkills' ? 'required skills' : key} gate</label><small id={`gate-${key}`} className="help-text">{gates[key]}</small></div>)}</div>
      <details><summary>Evidence and requirement settings</summary><div className="career-fields">{(['requiredMultiplier', 'preferredMultiplier', 'minimumEvidence', 'implicationCredit'] as const).map((key) => <label key={key}>{labels[key]}{key.includes('Multiplier') ? '' : ' (%)'}<input type="number" min={key.includes('Multiplier') ? .1 : 0} max={key.includes('Multiplier') ? 10 : 100} step="any" value={key.includes('Multiplier') ? ranking[key] : percent(ranking[key])} onChange={(e) => onChange({ ...ranking, [key]: Number(e.target.value) / (key.includes('Multiplier') ? 1 : 100) })} /></label>)}</div></details>
      {total !== 100 && <p className="help-text">Assign the remaining {Math.round((100 - total) * 10) / 10} points before saving.</p>}
      <button className="primary-button" onClick={onSave}>Save ranking configuration</button>
    </fieldset>
  </details>;
}
