import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapWordBoundaries } from '../src/edge/words.js';

/** @param {string[]} words */
const bounds = (words) => words.map((text, i) => ({ text, offset: 1_000_000 + i * 3_000_000, duration: 2_500_000 }));
/** @param {string} text @param {ReturnType<typeof mapWordBoundaries>} out */
const slices = (text, out) => out.map((w) => text.slice(w.charStart, w.charEnd));

test('converts ticks to seconds', () => {
  const out = mapWordBoundaries('Hello world', bounds(['Hello', 'world']));
  assert.deepEqual(out[0], { start: 0.1, end: 0.35, charStart: 0, charEnd: 5 });
  assert.deepEqual(out[1], { start: 0.4, end: 0.65, charStart: 6, charEnd: 11 });
});

test('repeated words map to successive occurrences', () => {
  const text = 'The cat saw the the dog. The end.';
  const out = mapWordBoundaries(text, bounds(['The', 'cat', 'saw', 'the', 'the', 'dog', 'The', 'end']));
  assert.deepEqual(out.map((w) => w.charStart), [0, 4, 8, 12, 16, 20, 25, 29]);
  assert.deepEqual(slices(text, out), ['The', 'cat', 'saw', 'the', 'the', 'dog', 'The', 'end']);
});

test('does not match inside a longer word', () => {
  const text = 'Therefore the theme';
  const out = mapWordBoundaries(text, bounds(['Therefore', 'the', 'theme']));
  assert.deepEqual(slices(text, out), ['Therefore', 'the', 'theme']);
  assert.equal(out[1].charStart, 10);
});

test('punctuation, quotes and symbols', () => {
  const text = 'Dr. Smith said “it’s fine” & left!';
  const out = mapWordBoundaries(text, bounds(['Dr.', 'Smith', 'said', "it's", 'fine', '&', 'left']));
  assert.deepEqual(slices(text, out), ['Dr.', 'Smith', 'said', 'it’s', 'fine', '&', 'left']);
});

test('numbers reported verbatim are located', () => {
  const text = 'He paid $42.50 on 3/4/2024 for 1,000 items.';
  const out = mapWordBoundaries(text, bounds(['He', 'paid', '$42.50', 'on', '3/4/2024', 'for', '1,000', 'items']));
  assert.deepEqual(slices(text, out), ['He', 'paid', '$42.50', 'on', '3/4/2024', 'for', '1,000', 'items']);
});

test('numbers the service expands are skipped, later words still map', () => {
  const text = 'I have 42 apples and 7 pears.';
  const out = mapWordBoundaries(text, bounds(['I', 'have', 'forty', 'two', 'apples', 'and', 'seven', 'pears']));
  assert.deepEqual(slices(text, out), ['I', 'have', 'apples', 'and', 'pears']);
});

test('a word that only appears far ahead is skipped, not mis-mapped', () => {
  const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa unknownword';
  const out = mapWordBoundaries(text, bounds(['alpha', 'unknownword', 'beta']));
  assert.deepEqual(slices(text, out), ['alpha', 'beta']);
});

test('reported word with extra punctuation falls back to its core', () => {
  const text = 'Wait for it';
  const out = mapWordBoundaries(text, bounds(['Wait,', 'for', 'it']));
  assert.deepEqual(slices(text, out), ['Wait', 'for', 'it']);
});

test('case and dash differences are tolerated; offsets stay UTF-16', () => {
  const text = '😀 Well‑known HELLO';
  const out = mapWordBoundaries(text, bounds(['Well-known', 'hello']));
  assert.deepEqual(slices(text, out), ['Well‑known', 'HELLO']);
  assert.equal(out[0].charStart, 3);
});

test('empty and whitespace words are ignored', () => {
  assert.deepEqual(mapWordBoundaries('a b', bounds(['', '  '])), []);
});

test('scripts without spaces (Chinese, Japanese) map word by word', () => {
  const text = '今天天气很好，我们去公园散步吧。今天';
  const words = ['今天', '天气', '很', '好', '我们', '去', '公园', '散步', '吧', '今天'];
  const out = mapWordBoundaries(text, bounds(words));
  assert.deepEqual(slices(text, out), words);
  assert.equal(out.at(-1)?.charStart, 16);
  const ja = 'これはテストです。';
  assert.deepEqual(slices(ja, mapWordBoundaries(ja, bounds(['これ', 'は', 'テスト', 'です']))), ['これ', 'は', 'テスト', 'です']);
});
