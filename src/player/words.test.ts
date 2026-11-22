import { describe, expect, it } from 'vitest';
import { estimatedWords, timedWords } from './words';

describe('estimatedWords', () => {
  // Weights: "a" 1+3, "bbbbbbb" 7+3, "cc" 2+3 → total 19; starts at 0, 4/19, 14/19 of the audio.
  const text = 'a bbbbbbb cc';
  const words = estimatedWords(text);

  it('maps an offset to the start of its word, the inverse of `at`', () => {
    expect(words.startOf(0, 1.9)).toBe(0);
    expect(words.startOf(2, 1.9)).toBeCloseTo(0.4);
    expect(words.startOf(5, 1.9)).toBeCloseTo(0.4);
    expect(words.startOf(10, 1.9)).toBeCloseTo(1.4);
    for (const offset of [0, 2, 8, 10, 11]) {
      const span = words.at(words.startOf(offset, 1.9), 1.9);
      expect(span && offset >= span.start && offset < span.end).toBe(true);
    }
  });

  it('picks the following word for whitespace and trailing punctuation', () => {
    const w = estimatedWords('Hello, big — world.');
    const start = (offset: number) => w.at(w.startOf(offset, 3), 3);
    expect(start(5)).toEqual({ start: 7, end: 10 }); // the comma after "Hello"
    expect(start(6)).toEqual({ start: 7, end: 10 }); // the space after it
    expect(start(11)).toEqual({ start: 13, end: 19 }); // the dash, a token of its own
    expect(start(1)).toEqual({ start: 0, end: 6 });
  });

  it('clamps offsets past the end to the last word', () => {
    expect(words.startOf(12, 1.9)).toBeCloseTo(1.4);
    expect(words.startOf(99, 1.9)).toBeCloseTo(1.4);
    expect(estimatedWords('Done.').startOf(5, 1)).toBe(0);
  });

  it('handles empty text and unknown duration', () => {
    expect(estimatedWords('').startOf(3, 1)).toBe(0);
    expect(words.startOf(5, 0)).toBe(0);
  });
});

describe('timedWords', () => {
  const words = timedWords([
    { start: 0.2, end: 0.4, charStart: 0, charEnd: 2 },
    { start: 0.5, end: 0.7, charStart: 4, charEnd: 7 },
    { start: 1.2, end: 1.6, charStart: 8, charEnd: 13 },
  ]); // "Hi, big world."

  it('starts at the real start of the word containing the offset', () => {
    expect(words.startOf(0, 2)).toBe(0.2);
    expect(words.startOf(5, 2)).toBe(0.5);
    expect(words.at(words.startOf(9, 2), 2)).toEqual({ start: 8, end: 13 });
  });

  it('picks the following word between words and the last word past the end', () => {
    expect(words.startOf(2, 2)).toBe(0.5); // the comma
    expect(words.startOf(3, 2)).toBe(0.5); // the space
    expect(words.startOf(13, 2)).toBe(1.2); // the full stop
    expect(words.startOf(50, 2)).toBe(1.2);
    expect(timedWords([]).startOf(3, 2)).toBe(0);
  });
});
