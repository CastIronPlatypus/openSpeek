import type { WordTiming } from '../types';

export interface WordSpan {
  start: number;
  end: number;
}

/** Maps between a sentence's audio position and its words, in both directions. */
export interface WordTracker {
  /** The word being spoken `seconds` into audio lasting `duration` seconds. */
  at(seconds: number, duration: number): WordSpan | null;
  /**
   * Inverse of `at`: seconds into the audio where the word containing `charOffset` starts.
   * An offset between words (whitespace, or punctuation after a word) picks the following
   * word; one past the last word picks the last word.
   */
  startOf(charOffset: number, duration: number): number;
}

/** Each word also gets this many characters' worth of time, for the pause around it. */
const PER_WORD_WEIGHT = 3;

/**
 * Lookups treat a position this close before a word's start as inside it, so a start time
 * from `startOf` (which the audio element may round) maps back to the same word.
 */
const TOLERANCE_SECONDS = 1e-3;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** End of `text[start, end)` without its trailing punctuation; `start` when it has no letters or digits. */
function coreEnd(text: string, start: number, end: number): number {
  for (let i = end; i > start; i--) {
    if (LETTER_OR_DIGIT.test(text[i - 1])) return i;
  }
  return start;
}

/**
 * Index of the word a character offset belongs to: the first word whose letters end after
 * it, skipping punctuation-only tokens; the last such word when the offset is past them all.
 */
function wordIndexAt(words: WordSpan[], cores: number[], offset: number): number {
  let last = -1;
  for (let k = 0; k < words.length; k++) {
    if (cores[k] <= words[k].start) continue; // punctuation only
    if (cores[k] > offset) return k;
    last = k;
  }
  return last >= 0 ? last : words.length - 1;
}

/** Spreads the audio over the words in proportion to their length. */
export function estimatedWords(text: string): WordTracker {
  const words: WordSpan[] = [];
  const cores: number[] = [];
  const ends: number[] = [];
  let total = 0;
  for (const m of text.matchAll(/\S+/g)) {
    const span = { start: m.index, end: m.index + m[0].length };
    words.push(span);
    cores.push(coreEnd(text, span.start, span.end));
    total += m[0].length + PER_WORD_WEIGHT;
    ends.push(total);
  }
  return {
    at(seconds, duration) {
      if (!words.length || !(duration > 0)) return null;
      const target = Math.max(0, Math.min(1, (seconds + TOLERANCE_SECONDS) / duration)) * total;
      return words[Math.min(firstAbove(ends, target), words.length - 1)];
    },
    startOf(charOffset, duration) {
      if (!words.length || !(duration > 0)) return 0;
      const k = wordIndexAt(words, cores, charOffset);
      return k > 0 ? (ends[k - 1] / total) * duration : 0;
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
  // Engines time words without their punctuation, so the whole span counts as the word.
  const cores = words.map((w) => w.end);
  return {
    at(seconds) {
      const k = firstAbove(starts, seconds + TOLERANCE_SECONDS) - 1;
      return k >= 0 ? words[k] : null;
    },
    startOf(charOffset) {
      if (!words.length) return 0;
      return starts[wordIndexAt(words, cores, charOffset)];
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
