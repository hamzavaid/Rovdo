/**
 * Accessible progress announcement shared by asynchronous feature workflows.
 */
export function OperationStatus({
  label,
  detail,
}: {
  label: string | null;
  detail?: string | undefined;
}) {
  if (!label) return null;
  return (
    <div className="operation-progress" role="status" aria-live="polite">
      <span className="activity-spinner" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  );
}
