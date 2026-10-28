/**
 * Reusable qualification labels, editable fields and source-evidence disclosure.
 * Internal identities, evidence bindings and conflict metadata are not exposed as ordinary form fields.
 */
import { useId, useState } from 'react';
import { resolveSkill, SKILLS } from '@rovdo/career';
import { evidenceText } from './evidence-presentation';
import type { Intelligence } from '@rovdo/shared';
import type { QualificationSection } from './profile-edit';
export type Qualification = Intelligence[QualificationSection][number];
export function qualificationTitle(item: Qualification): string {
  return 'skillId' in item
    ? (item.displayName ?? resolveSkill(item.skillId, 'skill')?.name ?? item.skillId)
    : 'title' in item
      ? item.title
      : 'name' in item
        ? item.name
        : `${item.institution || 'Education'} / ${item.level}`;
}
const labels: Record<string, string> = {
  skillId: 'Skill name',
  displayName: 'Display name',
  version: 'Technology version',
  depth: 'Practice depth',
  proficiency: 'Self-assessed proficiency',
  title: 'Job title',
  organization: 'Employer',
  roleFamily: 'Technical role family',
  level: 'Level',
  track: 'Career track',
  start: 'Start date',
  end: 'End date',
  ongoing: 'Currently ongoing (only when confirmed)',
  skills: 'Associated skills',
  production: 'Used in production',
  field: 'Field of study',
  institution: 'School / institution',
  status: 'Degree status',
  graduation: 'Graduation date',
  name: 'Name',
  coursework: 'Coursework (one course per line)',
  description: 'Description / contribution',
  url: 'Project link',
  issuer: 'Issuer',
  expires: 'Expiry date',
  license: 'Professional license',
};
const options: Record<string, string[]> = {
  depth: ['production', 'project', 'supporting', 'course', 'declared'],
  proficiency: ['unspecified', 'beginner', 'working', 'advanced', 'expert'],
  status: ['completed', 'enrolled', 'expected', 'incomplete'],
  track: ['ic', 'management', 'unknown'],
};
export function QualificationFields({
  item,
  section,
  prefix,
  onChange,
}: {
  item: Qualification;
  section: QualificationSection;
  prefix: string;
  onChange: (field: string, value: unknown) => void;
}) {
  const listId = useId();
  const [skillText, setSkillText] = useState('');
  const fields = Object.entries(item).filter(
    ([field]) =>
      !['id', 'evidenceIds', 'verified', 'metadata', 'recognition', 'conflictWith'].includes(field),
  );
  if (section === 'skills' && !fields.some(([k]) => k === 'proficiency'))
    fields.push(['proficiency', 'unspecified']);
  function controls(advanced: boolean) {
    return fields
      .filter(([f]) => ['roleFamily', 'track', 'production'].includes(f) === advanced)
      .map(([field, value]) => {
        const choices =
          field === 'level'
            ? section === 'experience'
              ? [
                  'unknown',
                  'intern',
                  'entry',
                  'junior',
                  'mid',
                  'senior',
                  'staff',
                  'principal',
                  'lead',
                ]
              : ['high-school', 'associate', 'bachelor', 'master', 'doctorate', 'other']
            : field === 'roleFamily'
              ? [
                  'unknown',
                  'software',
                  'embedded',
                  'robotics',
                  'hardware',
                  'platform',
                  'data-science',
                  'security',
                  'analytics',
                  'mechanical',
                  'electrical',
                  'civil',
                  'manufacturing',
                  'finance',
                  'healthcare',
                  ...(typeof value === 'string' &&
                  value &&
                  ![
                    'unknown',
                    'software',
                    'embedded',
                    'robotics',
                    'hardware',
                    'platform',
                    'data-science',
                    'security',
                    'analytics',
                    'mechanical',
                    'electrical',
                    'civil',
                    'manufacturing',
                    'finance',
                    'healthcare',
                  ].includes(value)
                    ? [value]
                    : []),
                ]
              : options[field];
        const label = `${prefix} ${field}`;
        const nullable = ['version', 'start', 'end', 'graduation', 'expires', 'url'].includes(
          field,
        );
        return (
          <label key={field}>
            {field === 'name'
              ? section === 'projects'
                ? 'Project name'
                : 'Certification name'
              : field === 'description'
                ? 'Description & contribution'
                : (labels[field] ?? 'Additional detail')}
            {typeof value === 'boolean' ? (
              <input
                aria-label={label}
                type="checkbox"
                checked={value}
                onChange={(e) => onChange(field, e.target.checked)}
              />
            ) : choices ? (
              <select
                aria-label={label}
                value={String(value ?? '')}
                onChange={(e) => onChange(field, e.target.value)}
              >
                {choices.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : field === 'skills' && Array.isArray(value) ? (
              <div className="editable-skill-chips">
                {value.map((s: string) => (
                  <span className="edit-skill-chip" key={s}>
                    {resolveSkill(s, 'skill')?.name ?? s.replace(/^custom:/, '')}
                    <button
                      type="button"
                      aria-label={`Remove associated skill ${s}`}
                      onClick={() =>
                        onChange(
                          field,
                          value.filter((v) => v !== s),
                        )
                      }
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <input
                  aria-label={label}
                  list={listId}
                  placeholder="Add a skill and press Enter"
                  value={skillText}
                  onChange={(e) => setSkillText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const name = skillText.trim();
                      if (name)
                        onChange(field, [
                          ...new Set([...value, resolveSkill(name, 'skill')?.id ?? name]),
                        ]);
                      setSkillText('');
                    }
                  }}
                />
              </div>
            ) : field === 'coursework' ? (
              <textarea
                aria-label={label}
                rows={5}
                value={Array.isArray(value) ? value.join('\n') : ''}
                onChange={(e) => onChange(field, e.target.value.split('\n').filter(Boolean))}
              />
            ) : field === 'description' ? (
              <textarea
                aria-label={label}
                rows={4}
                maxLength={3000}
                value={String(value)}
                onChange={(e) => onChange(field, e.target.value)}
              />
            ) : (
              <input
                aria-label={label}
                list={field === 'skillId' ? listId : undefined}
                placeholder={
                  ['start', 'end', 'graduation', 'expires'].includes(field)
                    ? 'YYYY, YYYY-MM, or YYYY-MM-DD'
                    : ''
                }
                value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                onChange={(e) =>
                  onChange(
                    field,
                    Array.isArray(value)
                      ? e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : e.target.value || (nullable ? null : ''),
                  )
                }
              />
            )}
          </label>
        );
      });
  }
  return (
    <>
      <div className="career-fields">{controls(false)}</div>
      <datalist id={listId}>
        {SKILLS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </datalist>
      {fields.some(([f]) => ['roleFamily', 'track', 'production'].includes(f)) && (
        <details>
          <summary>Matching details</summary>
          <div className="career-fields">{controls(true)}</div>
        </details>
      )}
      <p className="help-text">
        Keep unknown dates blank. Changing a record clears its verification. Custom skill names are
        supported.
      </p>
    </>
  );
}
export function QualificationEvidence({
  item,
  intelligence,
  open = false,
}: {
  item: Qualification;
  intelligence: Intelligence;
  open?: boolean;
}) {
  return (
    <details open={open}>
      <summary>Source evidence</summary>
      {item.evidenceIds.map((id) => {
        const e = intelligence.evidence.find((e) => e.id === id);
        return e ? (
          <blockquote key={id}>
            <p>{evidenceText(e.excerpt)}</p>
            {evidenceText(e.excerpt) !== e.excerpt && (
              <details>
                <summary>Original stored assertion</summary>
                <p>{e.excerpt}</p>
              </details>
            )}
            <small>
              {e.sourceKind} / {e.location ?? 'source excerpt'} / {Math.round(e.confidence * 100)}%
              extraction confidence
            </small>
          </blockquote>
        ) : null;
      })}
    </details>
  );
}
