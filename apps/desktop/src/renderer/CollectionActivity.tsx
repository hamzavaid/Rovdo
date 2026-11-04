/** A lightweight summary of the existing durable run, not a fabricated percentage or job count. */
import type { CareerCommand, DiscoveryViewSchema } from '@rovdo/shared';
import type { z } from 'zod';

export function CollectionActivity({
  view,
  busy,
  command,
  onHealth,
}: {
  view: z.infer<typeof DiscoveryViewSchema> | undefined;
  busy: boolean;
  command: (c: CareerCommand) => Promise<void>;
  onHealth: () => void;
}) {
  if (!view?.run) return null;
  const { run, coverage } = view;
  const running = run.status === 'running';
  const issues = coverage.filter(
    (s) => s.error || ['blocked', 'partial'].includes(s.status),
  ).length;
  const checked = coverage.filter(
    (s) => s.requests > 0 || s.records > 0 || s.status === 'ready',
  ).length;
  const current = coverage.find((s) => s.status === 'collecting' || s.status === 'retrying');
  const title = running
    ? 'Collection in progress'
    : run.status === 'completed' && issues
      ? 'Collection finished with unavailable sources'
      : `Collection ${run.status}`;
  return (
    <section className="collection-activity" aria-label="Discovery progress">
      <div className="collection-heading">
        <div role="status">
          <strong>{title}</strong>
          <p className="help-text">
            {running
              ? current
                ? `Checking ${view.registry.find((s) => s.id === current.sourceId)?.name ?? current.sourceId}`
                : 'Checking available sources and resolving employer boards'
              : 'Cached jobs remain searchable. Collection progress is saved.'}
          </p>
        </div>
        {running && (
          <button
            disabled={busy}
            onClick={() => void command({ op: 'controlDiscovery', id: run.id, action: 'cancel' })}
          >
            Stop
          </button>
        )}
        {run.status === 'paused' && (
          <button
            disabled={busy}
            onClick={() => void command({ op: 'controlDiscovery', id: run.id, action: 'resume' })}
          >
            Resume discovery
          </button>
        )}
      </div>
      {running && (
        <div className="collection-pulse" aria-hidden="true">
          <span />
        </div>
      )}
      <div className="collection-counters" aria-live="polite">
        <span>{view.jobs} unique jobs collected</span>
        <span>{view.companies} companies with collected jobs</span>
        <span>{checked} sources checked</span>
        <span>{issues} source issues</span>
      </div>
      <div className="collection-footer">
        <details>
          <summary>Activity details</summary>
          <p>
            {view.done} completed tasks / {view.pending} pending pages or resolutions /{' '}
            {view.listingCount} unresolved leads / {view.filtered} jobs filtered.
          </p>
          <p className="help-text">
            Collected jobs may already exist in your index. Unresolved leads are not verified
            employers or scored jobs.
          </p>
          {run.reason && <p>{run.reason}</p>}
          {running && (
            <button
              disabled={busy}
              onClick={() => void command({ op: 'controlDiscovery', id: run.id, action: 'pause' })}
            >
              Pause discovery
            </button>
          )}
        </details>
        <button className="text-action" onClick={onHealth}>
          View Collection Health
        </button>
      </div>
    </section>
  );
}
