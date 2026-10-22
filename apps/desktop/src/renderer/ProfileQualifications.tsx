/**
 * Compact structured qualification summaries and a focused editor dialog.
 * Edits clear verification; explicit confirmation creates evidence before the parent saves the profile draft.
 */
import { useState } from 'react';
import type { CandidateProfile } from '@rovdo/shared';
import type { QualificationSection } from './profile-edit';
import { QualificationEditor } from './QualificationEditor';
import { qualificationTitle } from './QualificationFields';
export function ProfileQualifications({
  profile,
  section,
  onUpdate,
  selectedId,
  onClose,
}: {
  selectedId?: string;
  onClose?: () => void;
  profile: CandidateProfile;
  section: QualificationSection;
  onUpdate: (update: (previous: CandidateProfile) => CandidateProfile) => void;
}) {
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const intel = profile.intelligence;
  const records = intel?.[section] ?? [];
  const id = selectedId ?? selected;
  const item = records.find((i) => i.id === id);
  const index = records.findIndex((i) => i.id === id);
  const close = () => {
    setSelected('');
    onClose?.();
  };
  return (
    <section aria-label={`Structured ${section}`} className="qualification-section">
      {!selectedId && (
        <>
          <label className="compact-search">
            Search {section}
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {!records.length && (
            <p className="help-text">
              No structured {section} yet. Import qualifications or add an evidence-backed fact.
            </p>
          )}
          <div className="qualification-rows">
            {records
              .filter((i) => qualificationTitle(i).toLowerCase().includes(query.toLowerCase()))
              .map((i) => (
                <button
                  type="button"
                  className="qualification-row"
                  key={i.id}
                  onClick={() => setSelected(i.id)}
                >
                  <span>
                    <strong>{qualificationTitle(i)}</strong>
                    <small>
                      {'organization' in i
                        ? i.organization
                        : 'description' in i
                          ? i.description.slice(0, 100)
                          : 'field' in i
                            ? i.field
                            : 'issuer' in i
                              ? i.issuer
                              : ''}
                    </small>
                  </span>
                  <span className={`verification-badge ${i.verified ? 'verified' : ''}`}>
                    {i.verified ? 'Verified' : 'Review'}
                  </span>
                </button>
              ))}
          </div>
        </>
      )}
      {item && intel && (
        <QualificationEditor
          key={item.id}
          profile={profile}
          section={section}
          item={item}
          index={index}
          onUpdate={onUpdate}
          onClose={close}
        />
      )}
    </section>
  );
}
