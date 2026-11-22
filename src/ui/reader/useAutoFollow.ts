import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { usePlayerState } from './usePlayerState';

/** After the reader scrolls by hand, leave the page alone for this long. */
const MANUAL_SCROLL_PAUSE_MS = 4000;
/** Smooth scrolls pass through "off screen"; only offer the pill once it stays that way. */
const PILL_DELAY_MS = 700;
const HEADER_SPACE = 72;
const MARGIN = 24;
// Arrow keys and Space are player shortcuts in the reader, so only these count as manual scrolling.
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Keeps the spoken sentence in view, pausing after manual scrolling, and reports whether the
 * sentence is off screen so the reader can offer a way back.
 */
export function useAutoFollow(enabled: boolean, bottomRef: RefObject<HTMLElement | null>) {
  const index = usePlayerState((s) => s.sentenceIndex);
  const manualScrollAt = useRef(0);
  const [offscreen, setOffscreen] = useState(false);

  const band = useCallback(() => {
    const bottomInset = bottomRef.current?.getBoundingClientRect().height ?? 0;
    return { top: HEADER_SPACE, bottom: innerHeight - bottomInset - MARGIN };
  }, [bottomRef]);

  const currentElement = useCallback(
    () => (index >= 0 ? document.querySelector<HTMLElement>(`[data-s="${index}"]`) : null),
    [index],
  );

  const scrollToElement = useCallback(
    (el: HTMLElement) => {
      const { top, bottom } = band();
      const target = window.scrollY + el.getBoundingClientRect().top - top - (bottom - top) * 0.25;
      window.scrollTo({ top: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    },
    [band],
  );

  useEffect(() => {
    const mark = () => {
      manualScrollAt.current = Date.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key) && !isTyping(e.target)) mark();
    };
    addEventListener('wheel', mark, { passive: true });
    addEventListener('touchmove', mark, { passive: true });
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('wheel', mark);
      removeEventListener('touchmove', mark);
      removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!enabled || Date.now() - manualScrollAt.current < MANUAL_SCROLL_PAUSE_MS) return;
    const el = currentElement();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { top, bottom } = band();
    if (r.top < top || r.bottom > bottom) scrollToElement(el);
  }, [enabled, currentElement, band, scrollToElement]);

  useEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      frame = 0;
      const el = currentElement();
      const r = el?.getBoundingClientRect();
      const { top, bottom } = band();
      const out = !!r && (r.bottom < top || r.top > bottom);
      clearTimeout(timer);
      if (out) timer = setTimeout(() => setOffscreen(true), PILL_DELAY_MS);
      else setOffscreen(false);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(check);
    };
    check();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
    };
  }, [currentElement, band]);

  const jumpToCurrent = useCallback(() => {
    manualScrollAt.current = 0;
    const el = currentElement();
    if (el) scrollToElement(el);
  }, [currentElement, scrollToElement]);

  /** Brings a sentence the user navigated to into view, as following would, and resumes following. */
  const scrollToSentence = useCallback(
    (sentenceIndex: number) => {
      manualScrollAt.current = 0;
      const el = document.querySelector<HTMLElement>(`[data-s="${sentenceIndex}"]`);
      if (el) scrollToElement(el);
    },
    [scrollToElement],
  );

  return { offscreen, jumpToCurrent, scrollToSentence };
}
