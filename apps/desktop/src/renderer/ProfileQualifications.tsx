/**
 * Compact structured qualification summaries and a focused editor dialog.
 * Edits clear verification; explicit confirmation creates evidence before the parent saves the profile draft.
 */
import { useState } from 'react';
import type { CandidateProfile } from '@rovdo/shared';
import { confirmQualification, updateQualification } from './profile-edit';
import type { QualificationSection } from './profile-edit';
import { ProfileDialog } from './ProfileDialog';
import {
  QualificationFields,
  QualificationEvidence,
  qualificationTitle,
} from './QualificationFields';
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
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
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
        <ProfileDialog title={qualificationTitle(item)} onClose={close}>
          {error && <p role="alert">{error}</p>}
          <fieldset className="action-surface" disabled={pending}>
            <details open>
              <summary>
                Edit {section} record {index + 1}
              </summary>
              <QualificationFields
                item={item}
                section={section}
                prefix={`${section} ${index + 1}`}
                onChange={(field, value) =>
                  onUpdate((prev) =>
                    prev.intelligence
                      ? {
                          ...prev,
                          intelligence: updateQualification(prev.intelligence, section, item.id, {
                            [field]: value,
                          }),
                        }
                      : prev,
                  )
                }
              />
            </details>
            <QualificationEvidence item={item} intelligence={intel} />
            {item.conflictWith?.length ? (
              <p className="help-text">
                Conflicting qualifications are excluded from technical matching. Review the sources
                and correct the inconsistent records before verifying them again.
              </p>
            ) : null}
            {'recognition' in item && (
              <p className="help-text">
                Recognition: {item.recognition ?? 'unspecified'}. A mention does not prove
                proficiency.
              </p>
            )}
            <label>
              <input
                type="checkbox"
                aria-label={`I verify this ${section} record ${index + 1}`}
                checked={item.verified}
                onChange={(e) => {
                  if (!e.target.checked) {
                    onUpdate((prev) =>
                      prev.intelligence
                        ? {
                            ...prev,
                            intelligence: updateQualification(
                              prev.intelligence,
                              section,
                              item.id,
                              {},
                            ),
                          }
                        : prev,
                    );
                    return;
                  }
                  setPending(true);
                  setError('');
                  void confirmQualification(intel, section, item.id)
                    .then((next) =>
                      onUpdate((prev) =>
                        prev.intelligence === intel ? { ...prev, intelligence: next } : prev,
                      ),
                    )
                    .catch(() =>
                      setError('Verification unavailable. Check record length and try again.'),
                    )
                    .finally(() => setPending(false));
                }}
              />
              I have reviewed and verify this qualification
            </label>
            <p className="help-text">
              Changes are kept in your draft. Save candidate profile after closing.
            </p>
            <button type="button" onClick={close}>
              Done
            </button>
          </fieldset>
        </ProfileDialog>
      )}
    </section>
  );
}
