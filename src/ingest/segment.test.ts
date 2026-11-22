import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block, Sentence } from '../types';
import { MAX_SENTENCE_LENGTH, regexSegments, segment } from './segment';

const para = (text: string): Block => ({ kind: 'paragraph', text });
const texts = (blocks: Block[]) => segment(blocks).map((s) => s.text);

function expectInvariants(blocks: Block[], sentences: Sentence[]) {
  sentences.forEach((s, i) => {
    expect(s.index).toBe(i);
    expect(s.text).toBe(blocks[s.block].text.slice(s.start, s.end));
    expect(s.text).toBe(s.text.trim());
    expect(s.text).toMatch(/[\p{L}\p{N}]/u);
  });
}

describe('segment', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('splits ordinary sentences with exact offsets', () => {
    const blocks = [para('  Hello there.  How are you?\tFine!  '), para('Second block. Two sentences.')];
    const sentences = segment(blocks);
    expect(sentences.map((s) => s.text)).toEqual(['Hello there.', 'How are you?', 'Fine!', 'Second block.', 'Two sentences.']);
    expect(sentences.map((s) => s.block)).toEqual([0, 0, 0, 1, 1]);
    expectInvariants(blocks, sentences);
  });

  it('does not split after abbreviations', () => {
    expect(texts([para('Mr. Smith met Dr. Jones at 3 p.m. today. They talked.')])).toEqual([
      'Mr. Smith met Dr. Jones at 3 p.m. today.',
      'They talked.',
    ]);
    expect(texts([para('See e.g. the U.S. Army vs. the Navy, i.e. two forces. Fruit, nuts, etc. Are fine.')])).toEqual([
      'See e.g. the U.S. Army vs. the Navy, i.e. two forces.',
      'Fruit, nuts, etc. Are fine.',
    ]);
  });

  it('does not split initials, but does split after the pronoun I', () => {
    expect(texts([para('J. K. Rowling wrote it. Yes! So did I. Then we left.')])).toEqual([
      'J. K. Rowling wrote it.',
      'Yes!',
      'So did I.',
      'Then we left.',
    ]);
  });

  it('keeps decimals and list numbers with their sentence', () => {
    expect(texts([para('Pi is 3.14159 roughly. 1. First item. 2. Second item.')])).toEqual([
      'Pi is 3.14159 roughly.',
      '1. First item.',
      '2. Second item.',
    ]);
  });

  it('merges fragments without letters or digits', () => {
    const blocks = [para('— Hello world. … !!! Next one.')];
    const sentences = segment(blocks);
    expect(sentences.map((s) => s.text)).toEqual(['— Hello world. … !!!', 'Next one.']);
    expectInvariants(blocks, sentences);
  });

  it('treats a heading as one sentence and skips unspeakable blocks', () => {
    const blocks: Block[] = [{ kind: 'heading', level: 1, text: 'Part one. The start' }, para('***'), para('Body.')];
    const sentences = segment(blocks);
    expect(sentences.map((s) => [s.block, s.text])).toEqual([
      [0, 'Part one. The start'],
      [2, 'Body.'],
    ]);
  });

  it('splits very long sentences at clause boundaries, never mid-word', () => {
    const clause = 'the quick brown fox jumps over the lazy dog while the cat watches';
    const text = `${Array.from({ length: 120 }, () => clause).join('; ')}.`;
    const blocks = [para(text)];
    const sentences = segment(blocks);
    expect(sentences.length).toBeGreaterThan(1);
    expectInvariants(blocks, sentences);
    for (const s of sentences) {
      expect(s.text.length).toBeLessThanOrEqual(MAX_SENTENCE_LENGTH);
      expect(s.text).toMatch(/^the .*(;|\.)$/);
    }
    expect(sentences.map((s) => s.text).join(' ')).toBe(text);
  });

  it('falls back to word boundaries when a long sentence has no punctuation', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ');
    const blocks = [para(text)];
    const sentences = segment(blocks);
    expectInvariants(blocks, sentences);
    for (const s of sentences) {
      expect(s.text.length).toBeLessThanOrEqual(MAX_SENTENCE_LENGTH);
      expect(s.text).toMatch(/^word\d+( word\d+)*$/);
    }
    expect(sentences.map((s) => s.text).join(' ')).toBe(text);
  });

  it('splits at commas and dashes when nothing stronger exists', () => {
    const text = `${Array.from({ length: 100 }, (_, i) => `item number ${i} is here and also there`).join(', ')} — and finally the end of it all.`;
    const sentences = segment([para(text)]);
    expect(sentences.length).toBeGreaterThan(1);
    expect(sentences[0].text.endsWith(',')).toBe(true);
  });

  it('keeps offsets exact on messy real-world text', () => {
    const blocks = [
      para('“Is it?” she asked.  (Yes.)  The U.K. one costs $3.50, approx. 2 lbs. Done… Really?! Ok.'),
      para('A sentence with\u00A0odd   spacing.  Another one here.'),
    ];
    expectInvariants(blocks, segment(blocks));
  });

  it('uses the regex fallback without Intl.Segmenter', async () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    vi.resetModules();
    const fresh = await import('./segment');
    const blocks = [para('Hello there. Mr. Smith is here! Is he? Yes.')];
    const sentences = fresh.segment(blocks);
    expect(sentences.map((s) => s.text)).toEqual(['Hello there.', 'Mr. Smith is here!', 'Is he?', 'Yes.']);
    expectInvariants(blocks, sentences);
  });

  it('regexSegments covers the whole text', () => {
    const text = 'One. Two? "Three!" Four';
    expect(regexSegments(text).map((s) => text.slice(s.start, s.end))).toEqual(['One. ', 'Two? ', '"Three!" ', 'Four']);
  });
});
