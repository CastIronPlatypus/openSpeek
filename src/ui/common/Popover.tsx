import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface PopoverProps {
  /** Accessible name of the trigger button. */
  label: string;
  buttonContent: ReactNode;
  buttonClassName?: string;
  /** Heading of the panel; also its accessible name. */
  title: string;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  panelClassName?: string;
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select, textarea, [href], [tabindex]:not([tabindex="-1"])';

/**
 * A button that toggles an anchored panel; on narrow screens the panel is a bottom sheet
 * (see `.popover-panel` in base.css). Closes on Esc, outside press, or focus leaving it.
 */
export function Popover({
  label,
  buttonContent,
  buttonClassName = 'icon-btn',
  title,
  placement = 'top',
  align = 'center',
  panelClassName = '',
  onOpen,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);
  const closeAndRestore = useCallback(() => close(true), [close]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!rootRef.current?.contains(target) || target.classList.contains('popover-backdrop')) close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, close]);

  return (
    <div
      className="popover"
      ref={rootRef}
      onBlur={(e) => {
        if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) close(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {buttonContent}
      </button>
      {open && (
        <>
          <div className="popover-backdrop" aria-hidden="true" />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={`popover-panel popover-panel--${placement} popover-panel--${align} ${panelClassName}`}
          >
            <div className="popover-head">
              <h2 id={titleId} className="popover-title">
                {title}
              </h2>
              <button type="button" className="icon-btn icon-btn--small" aria-label="Close" onClick={closeAndRestore}>
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="popover-body">{children(closeAndRestore)}</div>
          </div>
        </>
      )}
    </div>
  );
}
