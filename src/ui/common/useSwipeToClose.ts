import { useCallback, useRef, type PointerEvent, type RefObject } from 'react';

/** Dragged further than this (px), or flicked faster than this (px/ms), the sheet closes. */
const CLOSE_DISTANCE = 80;
const CLOSE_VELOCITY = 0.5;

/**
 * Drag-down-to-dismiss for a bottom sheet: spread the returned handlers on the sheet's grab area
 * (its header). The sheet follows the finger and closes past a threshold, else springs back.
 * Presses that start on a control are left alone so its click still works.
 */
export function useSwipeToClose(sheetRef: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const drag = useRef<{ id: number; y: number; time: number; dy: number } | null>(null);

  const reset = useCallback(() => {
    const sheet = sheetRef.current;
    drag.current = null;
    if (!sheet) return;
    sheet.style.transition = 'transform 0.2s var(--ease)';
    sheet.style.transform = '';
  }, [sheetRef]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!enabled || !e.isPrimary || e.button !== 0) return;
      if ((e.target as Element).closest('button, input, a, [role="button"]')) return;
      drag.current = { id: e.pointerId, y: e.clientY, time: e.timeStamp, dy: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      const sheet = sheetRef.current;
      if (!d || d.id !== e.pointerId || !sheet) return;
      d.dy = Math.max(0, e.clientY - d.y);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${d.dy}px)`;
    },
    [sheetRef],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const velocity = d.dy / Math.max(1, e.timeStamp - d.time);
      if (d.dy > CLOSE_DISTANCE || (d.dy > 16 && velocity > CLOSE_VELOCITY)) {
        drag.current = null;
        onClose();
      } else {
        reset();
      }
    },
    [onClose, reset],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset };
}
