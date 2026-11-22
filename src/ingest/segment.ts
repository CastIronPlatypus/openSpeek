import type { Block, Sentence } from '../types';

/** Sentences longer than this are split at clause boundaries for the TTS engine. */
export const MAX_SENTENCE_LENGTH = 350;
/** Don't produce clause pieces shorter than this when splitting long sentences. */
const MIN_PIECE_LENGTH = 60;

const SPEAKABLE = /[\p{L}\p{N}]/u;

/** Tokens after which a period does not end a sentence (lower-cased, without the final dot). */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'rev', 'hon', 'gen', 'col', 'capt',
  'lt', 'sgt', 'gov', 'sen', 'rep', 'pres', 'vs', 'v', 'etc', 'e.g', 'i.e', 'cf', 'viz', 'al', 'approx',
  'ca', 'no', 'nos', 'vol', 'vols', 'fig', 'figs', 'p', 'pp', 'ch', 'sec', 'ed', 'eds', 'inc', 'ltd',
  'co', 'corp', 'dept', 'est', 'u.s', 'u.k', 'u.n', 'e.u', 'a.m', 'p.m', 'ph.d', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

/** A lone list marker such as "1.", "b)" or "iv." left behind as its own segment. */
const LIST_MARKER = /^(\d{1,3}|[a-z]|[ivxlcdm]{1,6})[.)]$/i;
/** A single capital initial such as the "J." in "J. K. Rowling" (but not the pronoun "I."). */
const INITIAL = /^(?!I\.)\p{Lu}\.$/u;

interface Span {
  start: number;
  end: number;
}

let segmenter: Intl.Segmenter | null | undefined;

function rawSegments(text: string): Span[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
  }
  if (segmenter) {
    return Array.from(segmenter.segment(text), (s) => ({ start: s.index, end: s.index + s.segment.length }));
  }
  return regexSegments(text);
}

/** Fallback for engines without Intl.Segmenter: break after terminal punctuation plus whitespace. */
export function regexSegments(text: string): Span[] {
  const spans: Span[] = [];
  const boundary = /[.!?…]+["'”’)\]]*\s+/g;
  let start = 0;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    spans.push({ start, end });
    start = end;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

/** True when the boundary after `left` is a false sentence break that should be undone. */
function isFalseBreak(left: string, right: string): boolean {
  const l = left.trimEnd();
  const r = right.trimStart();
  if (!r) return false;
  if (!SPEAKABLE.test(l) || !SPEAKABLE.test(r)) return true;
  // A sentence never starts in lower case; the segmenter split after an unknown abbreviation.
  if (/^\p{Ll}/u.test(r)) return true;
  const lastToken = l.slice(l.search(/\S+$/)).replace(/^[("'“‘[]+/, '');
  if (!lastToken.endsWith('.')) return false;
  if (INITIAL.test(lastToken)) return true;
  if (ABBREVIATIONS.has(lastToken.slice(0, -1).toLowerCase())) return true;
  return LIST_MARKER.test(l);
}

function trimSpan(text: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

/** Clause boundaries, strongest first. Each match position is where the left piece ends. */
const CLAUSE_BREAKS = [/[;:](?=\s)/g, /\s?[—–]\s?|\s-\s/g, /,(?=\s)/g];

/** Split an over-long trimmed span at clause boundaries, falling back to whitespace, never mid-word. */
function splitLong(text: string, span: Span): Span[] {
  const pieces: Span[] = [];
  let { start } = span;
  while (span.end - start > MAX_SENTENCE_LENGTH) {
    const cut = findCut(text.slice(start, start + MAX_SENTENCE_LENGTH + 1));
    if (cut <= 0) break;
    pieces.push(trimSpan(text, { start, end: start + cut }));
    start = trimSpan(text, { start: start + cut, end: span.end }).start;
  }
  pieces.push({ start, end: span.end });
  return pieces.filter((p) => p.end > p.start);
}

/** Position in `window` after which to cut, or -1 when there is no safe place. */
function findCut(window: string): number {
  for (const pattern of CLAUSE_BREAKS) {
    let best = -1;
    for (const m of window.matchAll(pattern)) {
      // Keep the punctuation with the left piece; dashes start the right piece.
      const end = /[;:,]/.test(m[0]) ? m.index + 1 : m.index;
      if (end >= MIN_PIECE_LENGTH && end <= MAX_SENTENCE_LENGTH) best = end;
    }
    if (best > 0) return best;
  }
  const space = window.slice(0, MAX_SENTENCE_LENGTH).search(/\s\S*$/);
  return space >= MIN_PIECE_LENGTH ? space : -1;
}

/** Sentence spans of one paragraph's text, trimmed, repaired and length-limited. */
function paragraphSpans(text: string): Span[] {
  const merged: Span[] = [];
  for (const seg of rawSegments(text)) {
    const prev = merged[merged.length - 1];
    if (prev && isFalseBreak(text.slice(prev.start, prev.end), text.slice(seg.start, seg.end))) {
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged.map((s) => trimSpan(text, s)).flatMap((s) => splitLong(text, s));
}

/** Flatten blocks into speakable sentences with exact offsets into each block's text. */
export function segment(blocks: Block[]): Sentence[] {
  const sentences: Sentence[] = [];
  blocks.forEach((block, b) => {
    const spans = block.kind === 'heading' ? [trimSpan(block.text, { start: 0, end: block.text.length })] : paragraphSpans(block.text);
    for (const { start, end } of spans) {
      const text = block.text.slice(start, end);
      if (SPEAKABLE.test(text)) sentences.push({ index: sentences.length, block: b, start, end, text });
    }
  });
  return sentences;
}
