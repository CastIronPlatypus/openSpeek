import { useEffect, useRef } from 'react';

export interface ShortcutActions {
  toggle(): void;
  prev(): void;
  next(): void;
  faster(): void;
  slower(): void;
  back(): void;
  /** Section navigation; absent when the document has no sections. */
  prevSection?(): void;
  nextSection?(): void;
  contents?(): void;
}

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Space'], label: 'Play / pause' },
  { keys: ['←', '→'], label: 'Previous / next sentence' },
  { keys: ['⇧ ←', '⇧ →'], label: 'Previous / next section' },
  { keys: ['C'], label: 'Contents' },
  { keys: ['↓', '↑'], label: 'Slower / faster' },
  { keys: ['[', ']'], label: 'Slower / faster' },
  { keys: ['Esc'], label: 'Back to library' },
];

const isEditable = (el: HTMLElement) => el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

export function useReaderShortcuts(actions: ShortcutActions) {
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Popovers handle (and prevent) their own Esc; a modal dialog owns the keyboard.
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof HTMLElement ? e.target : document.body;
      if (isEditable(target)) return;
      const a = ref.current;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case ' ':
          // A focused button already activates on Space.
          if (!target.closest('button, a, [role="button"]')) run(a.toggle);
          break;
        case 'ArrowLeft':
          if (!e.shiftKey) run(a.prev);
          else if (a.prevSection) run(a.prevSection);
          break;
        case 'ArrowRight':
          if (!e.shiftKey) run(a.next);
          else if (a.nextSection) run(a.nextSection);
          break;
        case 'c':
        case 'C':
          if (a.contents) run(a.contents);
          break;
        case 'ArrowUp':
        case ']':
          run(a.faster);
          break;
        case 'ArrowDown':
        case '[':
          run(a.slower);
          break;
        case 'Escape':
          run(a.back);
          break;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
