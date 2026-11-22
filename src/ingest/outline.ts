import type { Block, Section, Sentence } from '../types';

/** Deepest indent shown, however deeply headings nest. */
export const MAX_DEPTH = 3;

/** "Previous section" restarts the current section when more than this many seconds into it. */
export const RESTART_THRESHOLD_SECONDS = 3;

/**
 * The document's table of contents: one section per heading that has speakable text, plus an
 * untitled leading section when sentences come before the first heading. A section runs from its
 * heading's sentence to the sentence before the next section, so a heading followed directly by
 * another heading still gets a section (its heading alone). Headings with nothing to speak
 * (e.g. "* * *") are left out: there would be nowhere to play from.
 *
 * Depth is the number of enclosing headings, capped at `MAX_DEPTH`: the shallowest level present
 * gets 0, and a jump from h1 to h4 indents one step, not three.
 */
export function outline(blocks: Block[], sentences: Sentence[]): Section[] {
  const starts: { block: number; first: number }[] = [];
  let lastBlock = -1;
  for (const s of sentences) {
    if (s.block === lastBlock) continue;
    lastBlock = s.block;
    if (blocks[s.block]?.kind === 'heading') starts.push({ block: s.block, first: s.index });
  }

  const sections: Section[] = [];
  const firstStart = starts.length ? starts[0].first : sentences.length;
  if (firstStart > 0 && sentences.length) {
    sections.push({
      title: '',
      level: 0,
      depth: 0,
      block: sentences[0].block,
      firstSentence: 0,
      lastSentence: firstStart - 1,
      sentenceCount: firstStart,
    });
  }

  const open: number[] = [];
  starts.forEach(({ block, first }, k) => {
    const level = Math.min(6, Math.max(1, blocks[block].level ?? 1));
    while (open.length && open[open.length - 1] >= level) open.pop();
    const depth = Math.min(MAX_DEPTH, open.length);
    open.push(level);
    const last = (k + 1 < starts.length ? starts[k + 1].first : sentences.length) - 1;
    sections.push({
      title: blocks[block].text,
      level,
      depth,
      block,
      firstSentence: first,
      lastSentence: last,
      sentenceCount: last - first + 1,
    });
  });
  return sections;
}

/** Index of the section containing `sentenceIndex` (binary search), or -1 when there is none. */
export function sectionAt(sections: readonly Section[], sentenceIndex: number): number {
  if (!sections.length || !(sentenceIndex >= sections[0].firstSentence)) return -1;
  let lo = 0;
  let hi = sections.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sections[mid].firstSentence <= sentenceIndex) lo = mid;
    else hi = mid - 1;
  }
  return sentenceIndex <= sections[lo].lastSentence ? lo : -1;
}

/**
 * Where "previous section" goes, as a sentence index: the start of the current section when
 * more than `RESTART_THRESHOLD_SECONDS` into it (the usual media convention), otherwise the start
 * of the previous section. `null` when there is nowhere to go.
 */
export function previousSectionStart(
  sections: readonly Section[],
  sentenceIndex: number,
  secondsIntoSection: number,
): number | null {
  const current = sectionAt(sections, sentenceIndex);
  if (current < 0) return null;
  if (secondsIntoSection > RESTART_THRESHOLD_SECONDS || current === 0) return sections[current].firstSentence;
  return sections[current - 1].firstSentence;
}

/** Where "next section" goes, as a sentence index; `null` in the last section. */
export function nextSectionStart(sections: readonly Section[], sentenceIndex: number): number | null {
  if (!sections.length) return null;
  if (sentenceIndex < sections[0].firstSentence) return sections[0].firstSentence;
  const current = sectionAt(sections, sentenceIndex);
  return current >= 0 && current + 1 < sections.length ? sections[current + 1].firstSentence : null;
}

/** Indices of sections whose title contains `query` (case-insensitive); all of them for a blank query. */
export function filterSections(sections: readonly Section[], query: string, untitled = ''): number[] {
  const q = query.trim().toLocaleLowerCase();
  const all = sections.map((_, i) => i);
  if (!q) return all;
  return all.filter((i) => (sections[i].title || untitled).toLocaleLowerCase().includes(q));
}
