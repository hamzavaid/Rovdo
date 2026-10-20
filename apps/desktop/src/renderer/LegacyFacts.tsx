/**
 * Compatibility UI for existing free-form candidate facts.
 * Keeps historical facts editable alongside structured qualifications without inventing typed records.
 */
import { useState } from 'react';
import type { CandidateProfile, ProfileFact } from '@rovdo/shared';
import { ProfileDialog } from './ProfileDialog';
export function FactEditor({
  profile,
  fact,
  onUpdate,
}: {
  profile: CandidateProfile;
  fact: ProfileFact;
  onUpdate: (u: (p: CandidateProfile) => CandidateProfile) => void;
}) {
  return (
    <div className="legacy-fact-editor">
      <label>
        Value
        <input
          aria-label={`${fact.field} value ${profile.facts.findIndex((f) => f.id === fact.id) + 1}`}
          value={fact.value}
          onChange={(e) => {
            const value = e.target.value;
            onUpdate((p) => ({
              ...p,
              facts: p.facts.map((f) =>
                f.id === fact.id
                  ? {
                      ...f,
                      value,
                      verified: false,
                      source: {
                        kind: 'user',
                        reference: 'User edited assertion',
                        capturedAt: new Date().toISOString(),
                      },
                    }
                  : f,
              ),
            }));
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={fact.verified}
          onChange={(e) => {
            const verified = e.target.checked;
            onUpdate((p) => ({
              ...p,
              facts: p.facts.map((f) => (f.id === fact.id ? { ...f, verified } : f)),
            }));
          }}
        />
        I verify this fact
      </label>
      <details>
        <summary>Source evidence</summary>
        <p>{fact.source.reference}</p>
        <small>{fact.source.kind}</small>
      </details>
      <button
        type="button"
        onClick={() => onUpdate((p) => ({ ...p, facts: p.facts.filter((f) => f.id !== fact.id) }))}
      >
        Remove fact
      </button>
      <p className="help-text">Save candidate profile to persist changes.</p>
    </div>
  );
}
export function LegacyFacts({
  profile,
  fields,
  onUpdate,
}: {
  profile: CandidateProfile;
  fields: string[];
  onUpdate: (u: (p: CandidateProfile) => CandidateProfile) => void;
}) {
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const records = profile.facts.filter((f) => fields.includes(f.field));
  const fact = records.find((f) => f.id === selected);
  if (!records.length) return null;
  return (
    <section aria-label="Additional profile facts">
      <label>
        Search additional facts
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="qualification-rows">
        {records
          .filter((f) => f.value.toLowerCase().includes(query.toLowerCase()))
          .map((f) => (
            <button
              type="button"
              className="qualification-row"
              key={f.id}
              onClick={() => setSelected(f.id)}
            >
              <span>
                <strong>{f.value}</strong>
                <small>{f.field}</small>
              </span>
              <span>{f.verified ? 'Verified' : 'Review'}</span>
            </button>
          ))}
      </div>
      {fact && (
        <ProfileDialog
          title={fact.field === 'skill' ? fact.value : 'Profile fact'}
          onClose={() => setSelected('')}
        >
          <FactEditor profile={profile} fact={fact} onUpdate={onUpdate} />
        </ProfileDialog>
      )}
    </section>
  );
}
