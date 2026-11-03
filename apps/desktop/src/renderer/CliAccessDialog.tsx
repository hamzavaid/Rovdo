/** Remembered text-sharing permissions are separate from CLI agent/browser execution capabilities. */
import { useState } from 'react';
import type { CliView } from '@rovdo/shared';
import { ProfileDialog } from './ProfileDialog';
import { errorMessage } from './messages';
export function CliAccessDialog({
  view,
  refresh,
  onClose,
}: {
  view: CliView;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [chat, setChat] = useState(view.authorization?.chat ?? false);
  const [files, setFiles] = useState(view.authorization?.selectedFiles ?? false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <ProfileDialog
      title="CLI access permissions"
      onClose={() => {
        if (!busy) onClose();
      }}
      closeLabel="Close CLI access permissions"
    >
      <p>
        Choose what Rovdo may share with {view.name}. Approval is remembered for this tested CLI
        identity and model. Its provider may process content remotely; subscription limits or
        charges may apply.
      </p>
      <div className="cli-permissions">
        <label>
          <input
            type="checkbox"
            aria-label="Chat messages"
            checked={chat}
            disabled={busy}
            onChange={(e) => {
              setChat(e.target.checked);
              if (!e.target.checked) setFiles(false);
            }}
          />
          <span>
            <strong>Chat messages</strong>
            <small>Share the visible completed conversation and new messages.</small>
          </span>
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="Selected files and folders"
            checked={files}
            disabled={busy || !chat}
            onChange={(e) => setFiles(e.target.checked)}
          />
          <span>
            <strong>Selected files and folders</strong>
            <small>
              Only bounded text snapshots from native pickers. No filesystem tools or background
              access.
            </small>
          </span>
        </label>
        <p className="help-text">
          Browser observations and actions are not granted by Chat. Browser workflows retain their
          separate approvals. Shell and agent tools stay disabled.
        </p>
        <p className="help-text">
          Changing permissions clears this CLI conversation and stops active chat requests. You can
          revoke sharing here or in Models &amp; Privacy.
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="button-row">
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={busy || !view.accessIdentity}
          onClick={() => {
            setBusy(true);
            void window
              .rovdo!.setCliAccess({
                id: view.id,
                identity: view.accessIdentity!,
                chat,
                selectedFiles: files,
              })
              .then(async (result) => {
                if (!result.ok) {
                  setError(errorMessage[result.code]);
                  return;
                }
                await refresh();
                onClose();
              })
              .catch(() => setError(errorMessage.INTERNAL_ERROR))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Saving...' : 'Save permissions'}
        </button>
      </div>
    </ProfileDialog>
  );
}
