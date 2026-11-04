/** Optional, minimized advisory review retains exact-payload approval and hosted-provider budget. */
import { useEffect, useState } from 'react';
import { reviewPayload, reviewRequestHash } from '@rovdo/career';
import type { CareerCommand, CareerViewSchema, SettingsView } from '@rovdo/shared';
import type { z } from 'zod';
import { ProfileDialog } from './ProfileDialog';
export function JobReview({
  jobId,
  view,
  settings,
  command,
  onClose,
}: {
  jobId: string;
  view: z.infer<typeof CareerViewSchema>;
  settings: SettingsView;
  command: (c: CareerCommand) => Promise<void>;
  onClose: () => void;
}) {
  const [model, setModel] = useState(''),
    [consent, setConsent] = useState(false),
    [hash, setHash] = useState('');
  const match = view.matches.find((m) => m.job.id === jobId),
    ranking = view.rankingProfiles.find((p) => p.id === match?.ranking?.configId);
  const config = settings.profiles.find((p) => p.config.id === model)?.config;
  const payload =
    match && ranking && view.profile && match.ranking?.asOf
      ? reviewPayload(view.profile, [match.job], {
          ranking,
          asOf: match.ranking.asOf,
          retrieval: { [jobId]: match.bm25Raw },
        })
      : null;
  const signature = JSON.stringify({ payload, config });
  useEffect(() => {
    let stale = false;
    setConsent(false);
    setHash('');
    if (payload && config)
      void reviewRequestHash(payload, config).then((h) => {
        if (!stale) setHash(h);
      });
    return () => {
      stale = true;
    };
  }, [signature]);
  return (
    <ProfileDialog title="Optional AI shortlist review" onClose={onClose}>
      <p>
        Advisory only. Deterministic eligibility and evidence verification remain authoritative.
      </p>
      <label>
        Review model
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Select a model</option>
          {settings.profiles.map((p) => (
            <option key={p.config.id} value={p.config.id}>
              {p.config.label} · {p.config.model}
            </option>
          ))}
        </select>
      </label>
      <p>
        Destination: {config?.baseUrl ?? 'choose a model'} · estimated spend cap $0.10 · one saved
        job.
      </p>
      <details>
        <summary>Exact outbound content</summary>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </details>
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I
        approve sharing this payload with this model
      </label>
      <button
        disabled={!consent || !hash || !model || !match || match.excluded}
        onClick={() =>
          void command({
            op: 'evaluate',
            jobIds: [jobId],
            modelProfileId: model,
            rankingId: ranking?.id,
            asOf: match?.ranking?.asOf,
            payloadHash: hash,
            maxUsd: 0.1,
            consent: true,
          })
        }
      >
        Evaluate saved job
      </button>
    </ProfileDialog>
  );
}
