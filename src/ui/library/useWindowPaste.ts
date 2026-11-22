import { useEffect, useRef } from 'react';
import { isPasteForLibrary, pasteEventData, type PasteData } from './paste';

/** Takes pastes made anywhere on the page, except into fields and dialogs, which keep theirs. */
export function useWindowPaste(onPaste: (data: PasteData) => void) {
  const onPasteRef = useRef(onPaste);
  useEffect(() => {
    onPasteRef.current = onPaste;
  });

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData || !isPasteForLibrary()) return;
      e.preventDefault();
      onPasteRef.current(pasteEventData(e.clipboardData));
    };
    addEventListener('paste', paste);
    return () => removeEventListener('paste', paste);
  }, []);
}
