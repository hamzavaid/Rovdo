import { SKILLS } from '@rovdo/career';
import { useState } from 'react';
import type { CandidateProfile } from '@rovdo/shared';
import { confirmQualification, updateQualification } from './profile-edit';
import type { QualificationSection } from './profile-edit';
const readable: Record<string, string> = { skillId: 'Skill', roleFamily: 'Role family', start: 'Start date', end: 'End date', evidenceIds: 'Source evidence', production: 'Used in production', url: 'Project URL', level: 'Level', depth: 'Practice depth', graduation: 'Graduation date', expires: 'Expiry date' };
const nullable = ['version', 'start', 'end', 'graduation', 'expires', 'url'];
const choices: Record<string, string[]> = { depth: ['production', 'project', 'supporting', 'course', 'declared'], status: ['completed', 'enrolled', 'expected', 'incomplete'], level: ['high-school', 'associate', 'bachelor', 'master', 'doctorate', 'other'], track: ['ic', 'management', 'unknown'] };
export function ProfileQualifications({ profile, section, onUpdate, selectedId }: { selectedId?: string; profile: CandidateProfile; section: QualificationSection; onUpdate: (update: (previous: CandidateProfile) => CandidateProfile) => void }) {
  const [error, setError] = useState(''); const [pending, setPending] = useState('');
  const intelligence = profile.intelligence; const records = intelligence?.[section] ?? [];
  return <section aria-label={`Structured ${section}`} className="qualification-section">{error && <p role="alert">{error}</p>}
    {!records.length && <p className="empty-state">No structured {section} yet. Import qualifications or add an evidence-backed fact below.</p>}
    {records.map((item, index) => (!selectedId || selectedId === item.id) && <article className="qualification" key={item.id}>
      <div className="section-heading"><strong>{'skillId' in item ? SKILLS.find((s) => s.id === item.skillId)?.name ?? item.skillId : 'title' in item ? item.title : 'name' in item ? item.name : 'institution' in item ? `${item.level} / ${item.institution}` : section}</strong><span className={`verification-badge ${item.verified ? 'verified' : ''}`}>{item.verified ? 'Verified' : 'Needs verification'}</span></div>
      <details><summary>Edit {section} record {index + 1}</summary><fieldset disabled={!!pending}><div className="career-fields">{Object.entries(item).filter(([field]) => !['id', 'evidenceIds', 'verified', 'metadata'].includes(field)).map(([field, value]) => {
        const label = `${section} ${index + 1} ${field}`;
        const options = field === 'level' && section === 'experience' ? ['unknown', 'intern', 'entry', 'junior', 'mid', 'senior', 'staff', 'principal', 'lead'] : choices[field];
        const edit = (value: unknown) => onUpdate((prev) => prev.intelligence ? { ...prev, intelligence: updateQualification(prev.intelligence, section, item.id, { [field]: value }) } : prev);
        return <label key={field}>{readable[field] ?? field}{field === 'skillId' ? <select aria-label={label} value={String(value)} onChange={(e) => edit(e.target.value)}>{!SKILLS.some((s) => s.id === value) && <option value={String(value)}>{String(value)}</option>}{SKILLS.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select> : typeof value === 'boolean' ? <input aria-label={label} type="checkbox" checked={value} onChange={(e) => edit(e.target.checked)} /> : options ? <select aria-label={label} value={String(value ?? '')} onChange={(e) => edit(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select> : <input aria-label={label} value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} onChange={(e) => edit(Array.isArray(value) ? e.target.value.split(',').map((v) => v.trim()).filter(Boolean) : e.target.value || (nullable.includes(field) ? null : ''))} />}</label>;
      })}</div></fieldset><p className="help-text">Editing clears verification. Review the record, explicitly verify it, then Save candidate profile.</p></details>
      <details><summary>Source evidence</summary>{item.evidenceIds.map((ref) => { const e = intelligence?.evidence.find((e) => e.id === ref); return e ? <blockquote key={ref}><p>{e.excerpt}</p><small>{e.sourceKind} / {e.sourceId} / {Math.round(e.confidence * 100)}% extraction confidence</small></blockquote> : null; })}</details>
      <label><input type="checkbox" checked={item.verified} disabled={!!pending} onChange={(e) => {
        if (!e.target.checked) { onUpdate((prev) => prev.intelligence ? { ...prev, intelligence: updateQualification(prev.intelligence, section, item.id, {}) } : prev); return; }
        if (!intelligence) return; setPending(item.id); setError('');
        void confirmQualification(intelligence, section, item.id).then((next) => onUpdate((prev) => prev.intelligence === intelligence ? { ...prev, intelligence: next } : prev)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Verification unavailable')).finally(() => setPending(''));
      }} />I verify this {section} record {index + 1}</label>
    </article>)}
  </section>;
}
