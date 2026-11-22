import { describe, expect, it } from 'vitest';
import type { Block } from '../types';
import { filterSections, nextSectionStart, outline, previousSectionStart, sectionAt } from './outline';
import { segment } from './segment';

const h = (level: number, text: string): Block => ({ kind: 'heading', level, text });
const p = (text: string): Block => ({ kind: 'paragraph', text });

function build(blocks: Block[]) {
  const sentences = segment(blocks);
  return { sentences, sections: outline(blocks, sentences) };
}

describe('outline', () => {
  it('derives sections with sentence ranges', () => {
    const blocks = [h(1, 'One'), p('Alpha. Beta.'), h(2, 'Two'), p('Gamma.')];
    const { sections } = build(blocks);
    expect(sections).toEqual([
      { title: 'One', level: 1, depth: 0, block: 0, firstSentence: 0, lastSentence: 2, sentenceCount: 3 },
      { title: 'Two', level: 2, depth: 1, block: 2, firstSentence: 3, lastSentence: 4, sentenceCount: 2 },
    ]);
  });

  it('adds an untitled leading section for text before the first heading', () => {
    const { sections } = build([p('Intro one. Intro two.'), h(2, 'Body'), p('Text.')]);
    expect(sections.map((s) => [s.title, s.level, s.firstSentence, s.sentenceCount])).toEqual([
      ['', 0, 0, 2],
      ['Body', 2, 2, 2],
    ]);
  });

  it('is one untitled section without headings, and empty without sentences', () => {
    expect(build([p('Just text. More.')]).sections).toHaveLength(1);
    expect(build([]).sections).toEqual([]);
  });

  it('keeps headings with nothing under them, and drops headings with nothing to speak', () => {
    const { sections } = build([h(1, 'Part One'), h(2, 'Chapter 1'), p('Text.'), h(2, '* * *'), p('More.'), h(2, 'Last')]);
    expect(sections.map((s) => [s.title, s.sentenceCount])).toEqual([
      ['Part One', 1],
      ['Chapter 1', 3], // the unspeakable "* * *" heading folds into the section before it
      ['Last', 1],
    ]);
  });

  it('normalises levels: shallowest is depth 0, skipped levels indent once, capped at 3', () => {
    const { sections } = build([
      h(2, 'A'), h(5, 'A.1'), h(6, 'A.1.1'), h(2, 'B'), h(3, 'B.1'), h(4, 'B.1.1'), h(5, 'B.1.1.1'), h(6, 'Deep'),
      h(3, 'B.2'), h(1, 'Top'),
    ]);
    expect(sections.map((s) => [s.title, s.depth])).toEqual([
      ['A', 0], ['A.1', 1], ['A.1.1', 2], ['B', 0], ['B.1', 1], ['B.1.1', 2], ['B.1.1.1', 3], ['Deep', 3],
      ['B.2', 1], ['Top', 0],
    ]);
  });

  it('starts at depth 0 when the document opens with a deep heading', () => {
    const { sections } = build([h(4, 'Small'), h(1, 'Big'), h(2, 'Under big')]);
    expect(sections.map((s) => s.depth)).toEqual([0, 0, 1]);
  });
});

describe('sectionAt', () => {
  const { sections, sentences } = build([p('Lead.'), h(1, 'A'), p('First one. Second one.'), h(2, 'B'), h(2, 'C'), p('Third one.')]);

  it('finds the section containing each sentence', () => {
    expect(sentences.map((s) => sectionAt(sections, s.index))).toEqual([0, 1, 1, 1, 2, 3, 3]);
    expect(sectionAt(sections, -1)).toBe(-1);
    expect(sectionAt(sections, sentences.length)).toBe(-1);
    expect(sectionAt([], 0)).toBe(-1);
  });

  it('scales to thousands of sentences and hundreds of headings', () => {
    const blocks: Block[] = [];
    for (let c = 0; c < 400; c++) blocks.push(h(c % 3 ? 2 : 1, `Chapter ${c}`), p('One. Two. Three. Four. Five.'), p('Six. Seven.'));
    const big = build(blocks);
    expect(big.sections).toHaveLength(400);
    for (const s of big.sentences) {
      const k = sectionAt(big.sections, s.index);
      expect(big.sections[k].firstSentence <= s.index && s.index <= big.sections[k].lastSentence).toBe(true);
    }
  });
});

describe('previous / next section', () => {
  // Sections start at sentences 0 (lead), 1 (A), 4 (B), 5 (C).
  const { sections } = build([p('Lead.'), h(1, 'A'), p('First one. Second one.'), h(2, 'B'), h(2, 'C'), p('Third one.')]);

  it('next goes to the following section start, or nowhere from the last', () => {
    expect(nextSectionStart(sections, 0)).toBe(1);
    expect(nextSectionStart(sections, 2)).toBe(4);
    expect(nextSectionStart(sections, 4)).toBe(5);
    expect(nextSectionStart(sections, 6)).toBeNull();
    expect(nextSectionStart([], 0)).toBeNull();
  });

  it('previous restarts the section when a few seconds in, else goes back one', () => {
    expect(previousSectionStart(sections, 3, 10)).toBe(1);
    expect(previousSectionStart(sections, 3, 1)).toBe(0);
    expect(previousSectionStart(sections, 1, 0)).toBe(0);
    expect(previousSectionStart(sections, 5, 3)).toBe(4);
    expect(previousSectionStart(sections, 5, 3.5)).toBe(5);
  });

  it('previous in the first section goes to its start', () => {
    expect(previousSectionStart(sections, 0, 0)).toBe(0);
    expect(previousSectionStart(sections, 0, 30)).toBe(0);
    expect(previousSectionStart([], 0, 0)).toBeNull();
  });
});

describe('filterSections', () => {
  const { sections } = build([p('Lead.'), h(1, 'The Storm'), h(2, 'After the STORM'), h(2, 'Calm')]);
  it('matches titles case-insensitively by substring', () => {
    expect(filterSections(sections, 'storm')).toEqual([1, 2]);
    expect(filterSections(sections, '  CALM ')).toEqual([3]);
    expect(filterSections(sections, '')).toEqual([0, 1, 2, 3]);
    expect(filterSections(sections, 'begin', 'Beginning')).toEqual([0]);
    expect(filterSections(sections, 'zzz')).toEqual([]);
  });
});
