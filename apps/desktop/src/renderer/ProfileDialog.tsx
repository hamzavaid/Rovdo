/**
 * Shared centered qualification dialog using native dialog focus and dismissal behavior.
 * Restore focus to the opener when the modal closes so keyboard users retain their place.
 */
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
export function ProfileDialog({
  title,
  onClose,
  children,
  className = '',
  closeLabel = 'Close qualification editor',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`profile-dialog ${className}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button type="button" className="dialog-close" aria-label={closeLabel} onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>,
    document.body,
  );
}
