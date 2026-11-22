import { useEffect } from 'react';
import { useApp } from '../appModel';
import { useStore } from '../store';
import { CloseIcon } from './icons';

const TOAST_MS = 9000;

/** Shows the app's current notice; always rendered so the live region is in place before it changes. */
export function Toast() {
  const { notice } = useApp();
  const message = useStore(notice);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => notice.set(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [message, notice]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {message && (
        <div className="toast">
          <span>{message}</span>
          <button type="button" className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={() => notice.set(null)}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
