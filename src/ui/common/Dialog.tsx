import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { CloseIcon } from './icons';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `large`: full screen on phones. `sheet`: a bottom sheet on phones that stays above the on-screen keyboard. */
  size?: 'small' | 'large' | 'sheet';
}

/** Modal built on native `<dialog>`, which traps focus and handles Esc for us. */
export function Dialog({ open, onClose, title, children, footer, size = 'large' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useKeyboardInset(ref, open && size === 'sheet');

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/**
 * Publishes the height of the on-screen keyboard (the part of the layout viewport the visual
 * viewport no longer shows, below it) as `--keyboard-inset` on `ref`, so a bottom sheet can sit
 * above the keyboard where the browser does not resize the layout for it (iOS Safari, recent Chrome).
 */
function useKeyboardInset(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const vv = globalThis.visualViewport;
    const el = ref.current;
    if (!enabled || !vv || !el) return;
    const update = () => {
      // Pinch zoom also shrinks the visual viewport; only the keyboard should move the sheet.
      const inset = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
      el.style.setProperty('--keyboard-inset', `${inset}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      el.style.removeProperty('--keyboard-inset');
    };
  }, [ref, enabled]);
}
