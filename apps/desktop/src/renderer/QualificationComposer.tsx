/** Section-specific qualification proposals, plus an explicit catch-all for legacy identity/eligibility facts. */
import { useState } from 'react';
import type { CandidateProfile, ProfileFact } from '@rovdo/shared';
import { ProfileDialog } from './ProfileDialog';
import { QualificationFields } from './QualificationFields';
import { newQualification, proposeQualification } from './profile-edit';
import type { QualificationSection } from './profile-edit';
const types = [
  ['skills', 'Skill'],
  ['experience', 'Experience'],
  ['education', 'Education'],
  ['projects', 'Project'],
  ['certifications', 'Certification'],
  ['other', 'Other information'],
] as const;
export function QualificationComposer({
  profile,
  initial,
  onSave,
  onClose,
}: {
  profile: CandidateProfile;
  initial: QualificationSection | 'other';
  onSave: (p: CandidateProfile, section: QualificationSection | 'other') => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState(initial);
  const [item, setItem] = useState(() =>
    newQualification(initial === 'other' ? 'skills' : initial),
  );
  const [reference, setReference] = useState('');
  const [field, setField] = useState<ProfileFact['field']>('name');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noun = types.find((t) => t[0] === section)![1];
  async function add() {
    setBusy(true);
    setError('');
    try {
      const next =
        section === 'other'
          ? {
              ...profile,
              facts: [
                ...profile.facts,
                {
                  id: crypto.randomUUID(),
                  field,
                  value,
                  verified: false,
                  source: {
                    kind: 'user' as const,
                    reference,
                    capturedAt: new Date().toISOString(),
                  },
                },
              ],
            }
          : await proposeQualification(profile, section, item, reference);
      onSave(next, section);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && !e.message.startsWith('[')
          ? e.message
          : 'Review the fields and valid dates before adding this qualification.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ProfileDialog
      title={`Add ${noun.toLowerCase()}`}
      onClose={onClose}
      className="qualification-dialog"
    >
      <fieldset className="action-surface" disabled={busy}>
        <nav className="section-nav" aria-label="Qualification type">
          {types.map(([key, label]) => (
            <button
              type="button"
              aria-pressed={section === key}
              key={key}
              onClick={() => {
                setSection(key);
                setItem(newQualification(key === 'other' ? 'skills' : key));
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {error && <p role="alert">{error}</p>}
        <div className="qualification-editor-grid">
          <section>
            <h3>{noun} details</h3>
            {section === 'other' ? (
              <>
                <label>
                  Information type
                  <select
                    value={field}
                    onChange={(e) => setField(e.target.value as ProfileFact['field'])}
                  >
                    {[
                      'name',
                      'email',
                      'phone',
                      'link',
                      'citizenship',
                      'workAuthorization',
                      'clearance',
                      'degree',
                      'graduationYear',
                      'returnToSchool',
                    ].map((f) => (
                      <option key={f} value={f}>
                        {f.replace(/([A-Z])/g, ' $1')}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Information
                  <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    maxLength={4000}
                  />
                </label>
              </>
            ) : (
              <QualificationFields
                item={item}
                section={section}
                prefix={`New ${noun.toLowerCase()}`}
                onChange={(field, value) => setItem({ ...item, [field]: value })}
              />
            )}
          </section>
          <aside className="qualification-sidebar">
            <section className="editor-aside-card">
              <h3>Source evidence</h3>
              <label>
                Evidence or assertion reference
                <textarea
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="Document passage, project reference, or your own factual assertion"
                />
              </label>
              <p>
                New entries start unverified. Review them in your profile editor before confirming
                them for matching.
              </p>
            </section>
            <section className="editor-aside-card">
              <h3>Your information stays local</h3>
              <p>
                No AI request is made. Existing verified information is preserved, including
                duplicate canonical skills.
              </p>
            </section>
          </aside>
        </div>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!reference.trim() || (section === 'other' && !value.trim())}
            onClick={() => void add()}
          >
            Add {noun.toLowerCase()} for verification
          </button>
        </footer>
      </fieldset>
    </ProfileDialog>
  );
}
