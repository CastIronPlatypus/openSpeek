import type { WordTiming } from '../types';

export interface WordSpan {
  start: number;
  end: number;
}

/** Maps a position in a sentence's audio to the word being spoken. */
export interface WordTracker {
  at(seconds: number, duration: number): WordSpan | null;
}

/** Each word also gets this many characters' worth of time, for the pause around it. */
const PER_WORD_WEIGHT = 3;

/** Spreads the audio over the words in proportion to their length. */
export function estimatedWords(text: string): WordTracker {
  const words: WordSpan[] = [];
  const ends: number[] = [];
  let total = 0;
  for (const m of text.matchAll(/\S+/g)) {
    words.push({ start: m.index, end: m.index + m[0].length });
    total += m[0].length + PER_WORD_WEIGHT;
    ends.push(total);
  }
  return {
    at(seconds, duration) {
      if (!words.length || !(duration > 0)) return null;
      const target = Math.max(0, Math.min(1, seconds / duration)) * total;
      return words[Math.min(firstAbove(ends, target), words.length - 1)];
    },
  };
}

/**
 * Uses an engine's real timings: the word whose start was passed last, so
 * pauses between words keep the previous one highlighted.
 */
export function timedWords(timings: WordTiming[]): WordTracker {
  const words = timings.map((w) => ({ start: w.charStart, end: w.charEnd }));
  const starts = timings.map((w) => w.start);
  return {
    at(seconds) {
      const k = firstAbove(starts, seconds) - 1;
      return k >= 0 ? words[k] : null;
    },
  };
}

/** Index of the first element of ascending `values` greater than `target`. */
function firstAbove(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] > target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
