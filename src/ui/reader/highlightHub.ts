import type { Player, PlayerState } from '../../types';

export type WordRange = NonNullable<PlayerState['word']>;

/** Snapshot for the current sentence when no word is known yet. */
export const NO_WORD: WordRange = Object.freeze({ start: -1, end: -1 });

export interface HighlightHub {
  subscribe(index: number, listener: () => void): () => void;
  /** `null` for sentences that are not being spoken; a word range (maybe `NO_WORD`) for the one that is. */
  getSnapshot(index: number): WordRange | null;
}

/**
 * Routes player updates to sentence components by index. With thousands of sentences,
 * subscribing each one to the player would run thousands of selectors per word tick;
 * here a tick notifies only the current sentence, and a sentence change only the old and new one.
 */
export function createHighlightHub(player: Player): HighlightHub {
  const listeners = new Map<number, Set<() => void>>();
  let listenerCount = 0;
  let current = -1;
  let word: WordRange | null = null;
  let unsubscribe: (() => void) | null = null;

  const emit = (index: number) => listeners.get(index)?.forEach((l) => l());

  const sync = () => {
    const s = player.getState();
    if (s.sentenceIndex !== current) {
      const previous = current;
      current = s.sentenceIndex;
      word = s.word;
      emit(previous);
      emit(current);
    } else if (s.word?.start !== word?.start || s.word?.end !== word?.end) {
      // Compared by value: a fresh object with the same offsets must not re-render the sentence.
      word = s.word;
      emit(current);
    }
  };

  return {
    subscribe(index, listener) {
      if (!unsubscribe) {
        sync();
        unsubscribe = player.subscribe(sync);
      }
      let set = listeners.get(index);
      if (!set) listeners.set(index, (set = new Set()));
      set.add(listener);
      listenerCount++;
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(index);
        if (--listenerCount === 0 && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    getSnapshot(index) {
      if (!unsubscribe) sync();
      return index === current ? (word ?? NO_WORD) : null;
    },
  };
}
