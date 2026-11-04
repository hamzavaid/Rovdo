/** Optional legacy saved-company registration; public access still requires explicit reviewed permission. */
import { useState } from 'react';
import type { CareerCommand, SourceConfig } from '@rovdo/shared';
export function ManualJobSource({
  command,
  busy,
}: {
  command: (c: CareerCommand) => Promise<void>;
  busy: boolean;
}) {
  const [ats, setAts] = useState<SourceConfig['ats']>('greenhouse'),
    [company, setCompany] = useState(''),
    [tenant, setTenant] = useState(''),
    [region, setRegion] = useState<SourceConfig['region']>('global'),
    [interval, setInterval] = useState(1440),
    [permitted, setPermitted] = useState(false);
  return (
    <details>
      <summary>Register a saved ATS tenant manually</summary>
      <p className="help-text">
        Automatic discovery does not need company identifiers. This optional route preserves
        explicitly reviewed saved-source polling.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void command({
            op: 'saveSource',
            source: {
              id: crypto.randomUUID(),
              ats,
              company: company.trim(),
              tenant: tenant.trim(),
              region,
              intervalMs: interval * 60000,
              termsReviewedAt: new Date().toISOString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              enabled: true,
              priority: 0,
              missingGracePolls: 3,
            },
          });
        }}
      >
        <div className="career-fields">
          <label>
            ATS
            <select value={ats} onChange={(e) => setAts(e.target.value as SourceConfig['ats'])}>
              {['greenhouse', 'lever', 'ashby', 'smartrecruiters'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Employer name
            <input
              required
              maxLength={200}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
          <label>
            Public board / tenant identifier
            <input
              required
              pattern="[a-zA-Z0-9_-]+"
              maxLength={200}
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
            />
          </label>
          <label>
            Lever region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as SourceConfig['region'])}
            >
              <option value="global">Global</option>
              <option value="eu">EU</option>
            </select>
          </label>
          <label>
            Polling interval (minutes)
            <input
              type="number"
              min={1}
              max={43200}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={permitted}
            onChange={(e) => setPermitted(e.target.checked)}
          />
          I reviewed this source's access terms and permit read-only polling
        </label>
        <button disabled={busy || !permitted || !company.trim() || !tenant.trim()}>
          Add source
        </button>
      </form>
    </details>
  );
}
