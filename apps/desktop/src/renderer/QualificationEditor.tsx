/** Focused local editor: cancel discards changes; saving binds an explicit confirmation to new evidence. */
import { useState } from 'react';
import { CandidateProfileSchema, IntelligenceSchema } from '@rovdo/shared';
import type { CandidateProfile, Intelligence } from '@rovdo/shared';
import {
  QualificationFields,
  QualificationEvidence,
  qualificationTitle,
} from './QualificationFields';
import { ProfileDialog } from './ProfileDialog';
import { confirmQualification, normalizeQualification, updateQualification } from './profile-edit';
import type { QualificationSection } from './profile-edit';
export function QualificationEditor({
  profile,
  section,
  item,
  index,
  onUpdate,
  onClose,
}: {
  profile: CandidateProfile;
  section: QualificationSection;
  item: Intelligence[QualificationSection][number];
  index: number;
  onUpdate: (f: (p: CandidateProfile) => CandidateProfile) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(item));
  const [verified, setVerified] = useState(item.verified);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intel = profile.intelligence!;
  async function save() {
    if (busy) return;
    if (!dirty && verified === item.verified) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      let next = updateQualification(
        intel,
        section,
        item.id,
        normalizeQualification(section, draft),
      );
      next = IntelligenceSchema.parse(next);
      if (verified) next = await confirmQualification(next, section, item.id);
      const result = CandidateProfileSchema.parse({ ...profile, intelligence: next });
      onUpdate((previous) =>
        previous.intelligence === intel
          ? { ...previous, intelligence: result.intelligence }
          : previous,
      );
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && !e.message.startsWith('[')
          ? e.message
          : 'Check the fields, dates and supporting evidence.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ProfileDialog
      title={qualificationTitle(draft) || 'Edit qualification'}
      onClose={onClose}
      className="qualification-dialog"
    >
      <fieldset className="action-surface" disabled={busy}>
        {error && <p role="alert">{error}</p>}
        <div className="qualification-editor-grid">
          <section className="qualification-main">
            <h3>
              {section === 'projects'
                ? 'Project'
                : section === 'skills'
                  ? 'Skill'
                  : section === 'education'
                    ? 'Education'
                    : section === 'experience'
                      ? 'Experience'
                      : 'Certification'}{' '}
              details
            </h3>
            <QualificationFields
              item={draft}
              section={section}
              prefix={`${section} ${index + 1}`}
              onChange={(field, value) => {
                setDraft({ ...draft, [field]: value });
                setVerified(false);
                setDirty(true);
              }}
            />
          </section>
          <aside className="qualification-sidebar">
            <section className="editor-aside-card">
              <h3>Verification</h3>
              <span className={`verification-badge ${verified ? 'verified' : ''}`}>
                {verified ? 'Verified' : 'Needs verification'}
              </span>
              <p>
                Confirm the specific details and contribution shown here. Editing clears
                verification.
              </p>
              <label>
                <input
                  type="checkbox"
                  aria-label={`I verify this ${section} record ${index + 1}`}
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                />
                I have reviewed and verify this qualification
              </label>
              {draft.conflictWith?.length ? (
                <p>Conflicting sources need a consistent, explicitly confirmed version.</p>
              ) : null}
            </section>
            <section className="editor-aside-card">
              <QualificationEvidence item={item} intelligence={intel} open />
            </section>
            <p className="help-text">
              Keep unknown dates blank. No dates, production use or credentials are inferred.
            </p>
          </aside>
        </div>
        <footer className="dialog-actions">
          <p className="help-text">
            Changes stay in your draft until you save the candidate profile.
          </p>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={() => void save()}>
            Save to draft
          </button>
        </footer>
      </fieldset>
    </ProfileDialog>
  );
}
