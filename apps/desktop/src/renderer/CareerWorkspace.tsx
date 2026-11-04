/** Profile editing remains unchanged; Jobs owns its independent five-page workspace. */
import { useEffect, useRef, useState } from 'react';
import { emptyProfile } from '@rovdo/career';
import { CandidateProfileSchema, ProfileFactSchema } from '@rovdo/shared';
import type {
  CandidateProfile,
  CareerCommand,
  CareerViewSchema,
  ProfileFact,
  SettingsView,
} from '@rovdo/shared';
import type { z } from 'zod';
import { JobsWorkspace } from './JobsWorkspace';
import { initialJobSearch } from './jobs-state';
import { LegacyFacts } from './LegacyFacts';
import { QualificationComposer } from './QualificationComposer';
import { SkillsPanel } from './SkillsPanel';
import { useActionState } from './action-state';
import { OperationStatus } from './OperationStatus';
import { ProfileQualifications } from './ProfileQualifications';
import { ProfileIntelligence } from './ProfileIntelligence';
export function CareerWorkspace(props: {
  tab: 'profile' | 'jobs';
  settings: SettingsView;
  initialSavedOnly?: boolean;
  onProfile?: () => void;
}) {
  return props.tab === 'jobs' ? (
    <JobsWorkspace {...props} />
  ) : (
    <ProfileWorkspace settings={props.settings} />
  );
}
const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
function ProfileWorkspace({ settings }: { settings: SettingsView }) {
  const tab = 'profile' as const;
  const [view, setView] = useState<z.infer<typeof CareerViewSchema> | null>(null),
    [profile, setProfile] = useState<CandidateProfile>(emptyProfile),
    [error, setError] = useState('');
  const [rolesText, setRolesText] = useState(''),
    [excludedText, setExcludedText] = useState(''),
    [locationsText, setLocationsText] = useState(''),
    [preferredCompanies, setPreferredCompanies] = useState(''),
    [excludedCompanies, setExcludedCompanies] = useState('');
  const [profileSection, setProfileSection] = useState('skills'),
    [showAddSkill, setShowAddSkill] = useState(false),
    [field, setField] = useState<ProfileFact['field']>('skill'),
    [importText, setImportText] = useState('');
  const loaded = useRef(false);
  const { pending: busy, label: actionLabel, run } = useActionState();
  function setDraft(input: CandidateProfile) {
    setProfile(input);
    setRolesText(input.preferences.roles.join(', '));
    setExcludedText(input.preferences.excludedRoles.join(', '));
    setLocationsText(input.preferences.locations.join(', '));
    setPreferredCompanies(input.preferences.preferredCompanies?.join(', ') ?? '');
    setExcludedCompanies(input.preferences.excludedCompanies?.join(', ') ?? '');
  }
  async function refresh() {
    const r = await window.rovdo!.careerCommand({
      op: 'view',
      search: initialJobSearch,
      summary: true,
    });
    if (r.ok) {
      setView(r.view);
      if (!loaded.current) {
        setDraft(r.view.profile ?? emptyProfile());
        loaded.current = true;
      }
    } else setError(r.code);
  }
  useEffect(() => {
    let stale = false;
    void window
      .rovdo!.careerCommand({ op: 'view', search: initialJobSearch, summary: true })
      .then((r) => {
        if (!stale && r.ok) {
          setView(r.view);
          setDraft(r.view.profile ?? emptyProfile());
          loaded.current = true;
        }
      })
      .catch(() => {
        if (!stale) setError('Desktop unavailable');
      });
    return () => {
      stale = true;
    };
  }, []);
  async function command(cmd: CareerCommand) {
    await run('Saving candidate profile...', async () => {
      setError('');
      try {
        const r = await window.rovdo!.careerCommand(cmd);
        if (!r.ok) {
          setError(r.code);
          return;
        }
        setView(r.view);
        if (r.view.profile) setDraft(r.view.profile);
      } catch {
        setError('Invalid input or desktop unavailable');
      }
    });
  }
  function preferences(change: Partial<CandidateProfile['preferences']>) {
    setProfile({ ...profile, preferences: { ...profile.preferences, ...change } });
  }
  const factSection = (field: ProfileFact['field']) =>
    field === 'skill'
      ? 'skills'
      : field === 'experience'
        ? 'experience'
        : ['education', 'degree', 'graduationYear', 'returnToSchool'].includes(field)
          ? 'education'
          : ['project', 'link'].includes(field)
            ? 'projects'
            : 'identity';
  return (
    <div className="career-workspace">
      {error && <p role="alert">{error}</p>}
      <OperationStatus label={actionLabel ?? (!view && !error ? 'Loading workspace...' : null)} />
      <fieldset className="action-surface" disabled={busy || (!view && !error)} aria-busy={busy}>
        <div className="eyebrow">YOUR VERIFIED INFORMATION</div>
        <h1>Candidate profile</h1>
        <p>
          Only facts you explicitly verify influence matching. Citizenship and work authorization
          must be entered by you. Imported proposals never replace verified facts.
        </p>
        <p>Profile version {view?.profile?.version ?? 'not saved'}</p>
        <nav className="section-nav" aria-label="Profile sections">
          {[
            ['skills', 'Skills'],
            ['experience', 'Experience'],
            ['education', 'Education'],
            ['projects', 'Projects'],
            ['preferences', 'Preferences'],
            ['imports', 'Imports'],
            ['identity', 'Identity & eligibility'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={profileSection === id}
              onClick={() => setProfileSection(id!)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div hidden={profileSection !== 'imports'}>
          <ProfileIntelligence
            settings={settings}
            tab={tab}
            onChanged={(next) => {
              if (next) setDraft(next);
              loaded.current = false;
              void refresh();
            }}
          />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = CandidateProfileSchema.safeParse({
              ...profile,
              preferences: {
                ...profile.preferences,
                roles: list(rolesText),
                excludedRoles: list(excludedText),
                locations: list(locationsText),
                preferredCompanies: list(preferredCompanies),
                excludedCompanies: list(excludedCompanies),
              },
              version: (view?.profile?.version ?? 0) + 1,
            });
            if (parsed.success) void command({ op: 'saveProfile', profile: parsed.data });
            else setError('Check profile fields, provenance and weights (must sum to 1).');
          }}
        >
          <div hidden={profileSection !== 'skills'}>
            <SkillsPanel
              profile={profile}
              onUpdate={setProfile}
              onAdd={() => {
                setField('skill');
                setShowAddSkill(true);
              }}
            />
          </div>
          {(['experience', 'education', 'projects'] as const).map((section) => (
            <div hidden={profileSection !== section} key={section}>
              <h2>{section[0]!.toUpperCase() + section.slice(1)}</h2>
              <ProfileQualifications profile={profile} section={section} onUpdate={setProfile} />
              {section === 'education' && (
                <>
                  <h3>Certifications</h3>
                  <ProfileQualifications
                    profile={profile}
                    section="certifications"
                    onUpdate={setProfile}
                  />
                </>
              )}
            </div>
          ))}
          <LegacyFacts
            key={profileSection}
            profile={profile}
            fields={
              profileSection === 'skills'
                ? []
                : [
                    ...new Set(
                      profile.facts
                        .filter((f) => factSection(f.field) === profileSection)
                        .map((f) => f.field),
                    ),
                  ]
            }
            onUpdate={setProfile}
          />
          <div hidden={profileSection !== 'preferences'}>
            <h2>Preferences</h2>
            <p className="help-text">
              Soft preferences influence fit and search; explicit legal restrictions and eligibility
              remain separate.
            </p>
            <div className="career-fields">
              <label>
                Preferred roles
                <input value={rolesText} onChange={(e) => setRolesText(e.target.value)} />
              </label>
              <label>
                Excluded roles
                <input value={excludedText} onChange={(e) => setExcludedText(e.target.value)} />
              </label>
              <label>
                Preferred locations
                <input value={locationsText} onChange={(e) => setLocationsText(e.target.value)} />
              </label>
              <label>
                Preferred companies
                <input
                  value={preferredCompanies}
                  onChange={(e) => setPreferredCompanies(e.target.value)}
                />
              </label>
              <label>
                Excluded companies
                <input
                  value={excludedCompanies}
                  onChange={(e) => setExcludedCompanies(e.target.value)}
                />
              </label>
              <label>
                Minimum annual salary
                <input
                  type="number"
                  min="0"
                  value={profile.preferences.minimumSalary ?? ''}
                  onChange={(e) =>
                    preferences({
                      minimumSalary: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                Salary currency
                <input
                  maxLength={3}
                  value={profile.preferences.currency}
                  onChange={(e) => preferences({ currency: e.target.value.toUpperCase() })}
                />
              </label>
            </div>
            <fieldset>
              <legend>Allowed work modes (none means unrestricted)</legend>
              {(['remote', 'hybrid', 'onsite'] as const).map((mode) => (
                <label key={mode}>
                  <input
                    type="checkbox"
                    checked={profile.preferences.workModes.includes(mode)}
                    onChange={(e) =>
                      preferences({
                        workModes: e.target.checked
                          ? [...profile.preferences.workModes, mode]
                          : profile.preferences.workModes.filter((m) => m !== mode),
                      })
                    }
                  />
                  {mode}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Allowed levels (none means unrestricted)</legend>
              {(['internship', 'new-grad', 'junior', 'mid', 'senior'] as const).map((level) => (
                <label key={level}>
                  <input
                    type="checkbox"
                    checked={profile.preferences.levels.includes(level)}
                    onChange={(e) =>
                      preferences({
                        levels: e.target.checked
                          ? [...profile.preferences.levels, level]
                          : profile.preferences.levels.filter((l) => l !== level),
                      })
                    }
                  />
                  {level}
                </label>
              ))}
            </fieldset>
            <p className="help-text">
              Select or customize ranking configurations from Jobs. Legacy v1 preserves the original
              weights.
            </p>
          </div>
          <button disabled={busy} type="submit">
            Save candidate profile
          </button>
        </form>
        <button
          type="button"
          className="text-action"
          hidden={['imports', 'preferences', 'skills'].includes(profileSection)}
          onClick={() => {
            setField(
              profileSection === 'experience'
                ? 'experience'
                : profileSection === 'education'
                  ? 'education'
                  : profileSection === 'projects'
                    ? 'project'
                    : 'name',
            );
            setShowAddSkill(true);
          }}
        >
          + Add{' '}
          {profileSection === 'experience'
            ? 'experience'
            : profileSection === 'education'
              ? 'education'
              : profileSection === 'projects'
                ? 'a project'
                : 'other information'}
        </button>
        {showAddSkill && (
          <QualificationComposer
            profile={profile}
            initial={
              field === 'skill'
                ? 'skills'
                : field === 'project'
                  ? 'projects'
                  : field === 'education'
                    ? 'education'
                    : field === 'experience'
                      ? 'experience'
                      : 'other'
            }
            onClose={() => setShowAddSkill(false)}
            onSave={(next, section) => {
              setProfile(next);
              setProfileSection(
                section === 'other'
                  ? 'identity'
                  : section === 'certifications'
                    ? 'education'
                    : section,
              );
            }}
          />
        )}
        <details hidden={profileSection !== 'imports'}>
          <summary>Import proposed facts as JSON</summary>
          <p>
            Use an array of facts with id, field, value, verified, and source (kind, reference,
            capturedAt). Legal assertions require source kind user. All imported facts become
            unverified.
          </p>
          <textarea
            aria-label="Proposed facts JSON"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button
            disabled={busy || !view?.profile}
            onClick={() => {
              try {
                const raw: unknown = JSON.parse(importText);
                if (!Array.isArray(raw)) throw new Error();
                const facts = raw.map((f: unknown) => ProfileFactSchema.parse(f));
                void command({ op: 'proposeFacts', facts });
              } catch {
                setError('Invalid proposed facts JSON');
              }
            }}
          >
            Import proposals
          </button>
        </details>
      </fieldset>
    </div>
  );
}
