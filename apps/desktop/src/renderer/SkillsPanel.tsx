import { useState } from 'react';
import { resolveSkill } from '@rovdo/career';
import type { CandidateProfile } from '@rovdo/shared';
import { ProfileDialog } from './ProfileDialog';
import { FactEditor } from './LegacyFacts';
import { ProfileQualifications } from './ProfileQualifications';
function category(id: string, name: string): string {
  if (/verilog|vhdl|risc.?v|fpga|\bros\b|embedded|arduino/i.test(`${id} ${name}`)) return 'Hardware & Embedded';
  const type = resolveSkill(id, 'skill')?.type;
  return type === 'language' ? 'Programming' : ['framework', 'library', 'runtime'].includes(type ?? '') ? 'Frameworks & Libraries' : ['cloud', 'database'].includes(type ?? '') ? 'Data & Cloud' : type ? 'Tools & Methods' : 'Other skills';
}
export function SkillsPanel({ profile, onUpdate, onAdd }: { profile: CandidateProfile; onUpdate: (update: (p: CandidateProfile) => CandidateProfile) => void; onAdd: () => void }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState('');
  const skills = [
    ...(profile.intelligence?.skills.filter(s => s.verified || !profile.facts.some(f => f.field === 'skill' && f.verified && (resolveSkill(f.value, 'skill')?.id ?? f.value.toLowerCase()) === s.skillId)).map((s) => ({ key: `structured:${s.id}`, id: s.id, name: s.displayName ?? resolveSkill(s.skillId, 'skill')?.name ?? s.skillId, category: category(s.skillId, s.skillId), verified: s.verified, version: s.version })) ?? []),
    ...profile.facts.filter((f) => f.field === 'skill' && !profile.intelligence?.skills.some(s => (s.verified || !f.verified) && (resolveSkill(s.skillId, 'skill')?.id ?? s.skillId.toLowerCase()) === (resolveSkill(f.value, 'skill')?.id ?? f.value.toLowerCase()))).map((f) => ({ key: `fact:${f.id}`, id: f.id, name: resolveSkill(f.value, 'skill')?.name ?? f.value, category: category(f.value, f.value), verified: f.verified, version: null })),
  ];
  const filtered = skills.filter((s) => `${s.name} ${s.category}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedSkill = skills.find((s) => s.key === selected);
  const fact = selected.startsWith('fact:') ? profile.facts.find((f) => f.id === selectedSkill?.id) : null;
  return <section className="skills-panel surface-card" aria-label="Technical skills">
    <div className="section-heading"><div><h2>Technical Skills</h2><p className="help-text">{skills.length} skills / {skills.filter((s) => s.verified).length} verified. Select a skill to review or edit.</p></div><button type="button" className="skill-add" onClick={onAdd}>+ Add</button></div>
    <label className="skill-search"><span className="visually-hidden">Search your skills</span><input placeholder="Search your skills..." value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    {!skills.length && <p className="help-text">Add a skill or import qualifications from your profile sources.</p>}
    {!!skills.length && !filtered.length && <p className="help-text">No skills match this search.</p>}
    {['Programming', 'Hardware & Embedded', 'Frameworks & Libraries', 'Data & Cloud', 'Tools & Methods', 'Other skills'].map((group) => { const items = filtered.filter((s) => s.category === group); return items.length ? <div className="skill-group" key={group}><h3>{group}</h3><div className="skill-chips">{items.map((skill) => <button type="button" className="skill-chip" key={skill.key} aria-pressed={selected === skill.key} aria-label={`Edit ${skill.name} skill (${skill.verified ? 'verified' : 'needs verification'})`} onClick={() => setSelected(selected === skill.key ? '' : skill.key)}><span className={skill.verified ? 'skill-verified' : 'skill-unverified'} aria-hidden="true">{skill.verified ? '\u2713' : '\u25cb'}</span>{skill.name}{skill.version && <small>{skill.version}</small>}</button>)}</div></div> : null; })}
    {selectedSkill && (!fact ? <ProfileQualifications profile={profile} section="skills" selectedId={selectedSkill.id} onClose={() => setSelected('')} onUpdate={onUpdate} /> : <ProfileDialog title={selectedSkill.name} onClose={() => setSelected('')}><FactEditor profile={profile} fact={fact} onUpdate={onUpdate}/></ProfileDialog>)}
  </section>;
}
