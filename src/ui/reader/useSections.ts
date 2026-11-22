import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Section } from '../../types';
import { useApp } from '../appModel';
import { formatDuration } from '../format';
import type { SectionHub, SectionStatus } from './sectionHub';

/** Shown for the implicit section before the first heading. */
export const UNTITLED_SECTION = 'Beginning';

export const sectionTitle = (section: Section | undefined) => section?.title || UNTITLED_SECTION;

export function useCurrentSection(hub: SectionHub): number {
  return useSyncExternalStore(hub.subscribeCurrent, hub.current);
}

export function useSectionStatus(hub: SectionHub, index: number): SectionStatus {
  const subscribe = useCallback((listener: () => void) => hub.subscribeRow(index, listener), [hub, index]);
  return useSyncExternalStore(subscribe, () => hub.status(index));
}

/**
 * Listening time of each section at the current speed, from the player's own estimate. The array
 * keeps its identity until a label actually changes, so word ticks and refined estimates that do
 * not change any rounded label re-render nothing.
 */
export function useSectionDurations(sections: readonly Section[]): readonly string[] {
  const { player } = useApp().services;
  const cache = useRef<{ duration: number; rate: number; sections: readonly Section[]; labels: readonly string[] } | null>(null);
  const subscribe = useCallback((listener: () => void) => player.subscribe(listener), [player]);
  const snapshot = () => {
    const { duration, rate } = player.getState();
    const prev = cache.current;
    if (prev && prev.duration === duration && prev.rate === rate && prev.sections === sections) return prev.labels;
    const labels = sections.map((s) => formatDuration((player.timeAt(s.lastSentence + 1) - player.timeAt(s.firstSentence)) / rate));
    const same = prev && prev.sections === sections && labels.every((l, i) => l === prev.labels[i]);
    cache.current = { duration, rate, sections, labels: same ? prev.labels : labels };
    return cache.current.labels;
  };
  return useSyncExternalStore(subscribe, snapshot);
}

/** Share of a section already read, in whole percent, re-rendering once per sentence at most. */
export function useSectionProgress(section: Section): number {
  const { player } = useApp().services;
  const subscribe = useCallback((listener: () => void) => player.subscribe(listener), [player]);
  return useSyncExternalStore(subscribe, () => {
    const { sentenceIndex } = player.getState();
    const start = player.timeAt(section.firstSentence);
    const total = player.timeAt(section.lastSentence + 1) - start;
    if (total <= 0 || sentenceIndex < section.firstSentence) return 0;
    return Math.min(100, Math.round(((player.timeAt(sentenceIndex) - start) / total) * 100));
  });
}

/**
 * How the contents panel is shown: a bottom sheet on phones, a drawer over the text on mid-size
 * screens, and docked beside the reading column where it fits without narrowing the column
 * below a comfortable width (320 px panel + ~680 px column).
 */
export type ContentsMode = 'sheet' | 'drawer' | 'docked';

const DOCKED_QUERY = '(min-width: 1000px)';
const DRAWER_QUERY = '(min-width: 600px)';

function currentMode(): ContentsMode {
  if (typeof matchMedia !== 'function') return 'sheet';
  return matchMedia(DOCKED_QUERY).matches ? 'docked' : matchMedia(DRAWER_QUERY).matches ? 'drawer' : 'sheet';
}

export function useContentsMode(): ContentsMode {
  const [mode, setMode] = useState(currentMode);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const queries = [matchMedia(DOCKED_QUERY), matchMedia(DRAWER_QUERY)];
    const update = () => setMode(currentMode());
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return mode;
}

const OPEN_KEY = 'openspeek:contents-docked';

function readDockedPreference(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDockedPreference(open: boolean) {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage may be unavailable (private mode); the preference is only a convenience.
  }
}

/**
 * Open/closed state of the contents panel. The docked panel remembers being open for the
 * session (it can stay open while reading); the sheet and drawer always start closed.
 */
export function useContentsOpen(mode: ContentsMode, available: boolean) {
  const [open, setOpenState] = useState(() => available && mode === 'docked' && readDockedPreference());
  const docked = mode === 'docked';
  useEffect(() => {
    // Entering docked mode (a wider window, a rotated tablet) restores the remembered state;
    // leaving it closes the panel rather than turning it into a modal sheet.
    setOpenState(docked && available && readDockedPreference());
  }, [docked, available]);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (docked) writeDockedPreference(next);
    },
    [docked],
  );
  return [open && available, setOpen] as const;
}
