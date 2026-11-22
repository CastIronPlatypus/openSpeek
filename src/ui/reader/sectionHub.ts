import { sectionAt } from '../../ingest/outline';
import type { Player, Section } from '../../types';

export type SectionStatus = 'done' | 'current' | 'todo';

export interface SectionHub {
  readonly sections: readonly Section[];
  /** Index of the section being read, or -1. */
  current(): number;
  /** Called when the current section changes (not on every word or sentence). */
  subscribeCurrent(listener: () => void): () => void;
  /** Called only when this row's status changes. */
  subscribeRow(index: number, listener: () => void): () => void;
  status(index: number): SectionStatus;
}

/**
 * Routes player updates to the contents rows, like the highlight hub does for sentences: the
 * player ticks many times a second, but a row hears about it only when its own status changes.
 * Playback crossing a heading notifies the two rows involved; a jump notifies the rows between.
 */
export function createSectionHub(player: Player, sections: readonly Section[]): SectionHub {
  const rows = new Map<number, Set<() => void>>();
  const currentListeners = new Set<() => void>();
  let listenerCount = 0;
  let current = -1;
  let unsubscribe: (() => void) | null = null;

  const sync = () => {
    const next = sectionAt(sections, player.getState().sentenceIndex);
    if (next === current) return;
    const previous = current;
    current = next;
    // Rows between the two change between done and to do; at most the two ends during playback.
    const from = Math.max(0, Math.min(previous, next));
    const to = Math.max(previous, next);
    for (let i = from; i <= to; i++) rows.get(i)?.forEach((l) => l());
    currentListeners.forEach((l) => l());
  };

  const retain = () => {
    if (listenerCount++ === 0) {
      sync();
      unsubscribe = player.subscribe(sync);
    }
  };
  const release = () => {
    if (--listenerCount === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
  const read = () => {
    if (!unsubscribe) current = sectionAt(sections, player.getState().sentenceIndex);
    return current;
  };

  return {
    sections,
    current: read,
    subscribeCurrent(listener) {
      retain();
      currentListeners.add(listener);
      return () => {
        currentListeners.delete(listener);
        release();
      };
    },
    subscribeRow(index, listener) {
      retain();
      let set = rows.get(index);
      if (!set) rows.set(index, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) rows.delete(index);
        release();
      };
    },
    status(index) {
      const c = read();
      return index === c ? 'current' : index < c ? 'done' : 'todo';
    },
  };
}
