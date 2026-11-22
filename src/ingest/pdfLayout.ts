import type { Block } from '../types';
import { cleanText, headingKey, labelsMatch, makeBlock } from './text';

/** A text run positioned in PDF user space (y grows upwards, baseline). */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface PdfPage {
  items: PdfItem[];
}

/** A PDF outline (bookmark) entry, resolved to where it points. */
export interface PdfBookmark {
  title: string;
  /** Nesting depth, 1 for top-level entries. */
  depth: number;
  /** 0-based page index. */
  page: number;
  /** Top of the destination in PDF user space (y grows upwards), or `null` for the page top. */
  top: number | null;
}

/** A block with where its first line sits. */
interface PlacedBlock {
  block: Block;
  page: number;
  /** Approximate top of the first line, PDF user space. */
  top: number;
  fontSize: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  page: number;
}

const TERMINAL = /[.!?:…"”’)]$/;
const PAGE_NUMBER = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|\/)\s*\d{1,4})?$/i;
/** Lines this close to the top or bottom of a page are header/footer candidates. */
const EDGE_LINES = 3;

const round = (n: number, step: number) => Math.round(n / step) * step;

/** Group a page's items into lines (pdf.js returns them in content order). */
function pageLines(page: PdfPage, pageIndex: number): Line[] {
  const lines: Line[] = [];
  let current: (Line & { end: number; chars: Map<number, number> }) | null = null;
  for (const item of page.items) {
    if (!item.str) continue;
    const size = item.fontSize || 10;
    if (current && Math.abs(item.y - current.y) < size * 0.5 && item.x >= current.end - size) {
      const gap = item.x - current.end;
      const needsSpace = gap > size * 0.15 && !/\s$/.test(current.text) && !/^\s/.test(item.str);
      current.text += (needsSpace ? ' ' : '') + item.str;
      current.end = Math.max(current.end, item.x + item.width);
    } else {
      if (current) lines.push(finishLine(current));
      current = { text: item.str, x: item.x, y: item.y, width: 0, fontSize: size, page: pageIndex, end: item.x + item.width, chars: new Map() };
    }
    // The line's size is the one covering most characters, so a drop cap or symbol doesn't skew it.
    const key = round(size, 0.5);
    current.chars.set(key, (current.chars.get(key) ?? 0) + item.str.trim().length);
  }
  if (current) lines.push(finishLine(current));
  return lines.filter((l) => l.text.trim());
}

function finishLine(l: Line & { end: number; chars: Map<number, number> }): Line {
  const fontSize = [...l.chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? l.fontSize;
  return { text: cleanText(l.text), x: l.x, y: l.y, width: l.end - l.x, fontSize, page: l.page };
}

/** Text that recurs at the same spot on most pages (running headers, footers), plus bare page numbers. */
function removeFurniture(pages: Line[][]): Line[][] {
  const signature = (l: Line) => `${round(l.y, 4)}|${l.text.replace(/\d+/g, '#').toLowerCase()}`;
  const edges = (lines: Line[]) => [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)];
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const sig of new Set(edges(lines).map(signature))) counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return pages.map((lines) => {
    const edge = new Set(edges(lines));
    return lines.filter((l) => !edge.has(l) || (!PAGE_NUMBER.test(l.text) && (counts.get(signature(l)) ?? 0) < threshold));
  });
}

/** Most common value, weighted. */
function mode(weights: Map<number, number>, fallback: number): number {
  let best = fallback;
  let bestWeight = -1;
  for (const [value, weight] of weights) {
    if (weight > bestWeight) [best, bestWeight] = [value, weight];
  }
  return best;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Join two lines of the same paragraph, undoing end-of-line hyphenation ("exam-" + "ple"). */
function joinLines(left: string, right: string): string {
  if (/\p{L}[-\u00AD\u2010]$/u.test(left) && /^\p{Ll}/u.test(right)) return left.slice(0, -1) + right;
  return `${left} ${right}`;
}

/**
 * Rebuild headings and paragraphs from positioned text runs. Headings come from font sizes and,
 * when the PDF has an outline, from its bookmarks (see `mergeBookmarks`).
 */
export function layoutPages(pages: PdfPage[], bookmarks: PdfBookmark[] = []): Block[] {
  const placed = placeBlocks(pages);
  return bookmarks.length ? mergeBookmarks(placed, bookmarks) : placed.map((p) => p.block);
}

function placeBlocks(pages: PdfPage[]): PlacedBlock[] {
  const lines = removeFurniture(pages.map(pageLines)).flat();
  if (!lines.length) return [];

  const sizeWeights = new Map<number, number>();
  for (const l of lines) sizeWeights.set(l.fontSize, (sizeWeights.get(l.fontSize) ?? 0) + l.text.length);
  const bodySize = mode(sizeWeights, 10);
  const isHeading = (l: Line) => l.fontSize >= bodySize * 1.2 && l.text.length < 200;

  // Larger heading sizes get smaller (more important) levels.
  const headingSizes = [...new Set(lines.filter(isHeading).map((l) => l.fontSize))].sort((a, b) => b - a);
  const levelOf = (l: Line) => Math.min(6, headingSizes.indexOf(l.fontSize) + 1);

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [a, b] = [lines[i - 1], lines[i]];
    const gap = a.y - b.y;
    if (a.page === b.page && a.fontSize === bodySize && b.fontSize === bodySize && gap > 0) gaps.push(gap);
  }
  const lineGap = median(gaps) ?? bodySize * 1.2;
  const textWidth = Math.max(...lines.filter((l) => !isHeading(l)).map((l) => l.width), 0);

  const startsNewBlock = (prev: Line, line: Line): boolean => {
    if (isHeading(prev) !== isHeading(line) || prev.fontSize !== line.fontSize) return true;
    const gap = prev.y - line.y;
    if (prev.page !== line.page) return isHeading(line) || TERMINAL.test(prev.text);
    if (gap < 0 || gap > Math.max(lineGap, prev.fontSize) * 1.4) return true;
    if (isHeading(line)) return false;
    // A short line ending a sentence closes its paragraph even without extra spacing.
    if (TERMINAL.test(prev.text) && prev.width < textWidth * 0.75) return true;
    return TERMINAL.test(prev.text) && line.x > prev.x + line.fontSize;
  };

  const blocks: PlacedBlock[] = [];
  let group: Line[] = [];
  const flush = () => {
    if (!group.length) return;
    const text = group.map((l) => l.text).reduce(joinLines);
    const first = group[0];
    const block = isHeading(first) ? makeBlock('heading', text, levelOf(first)) : makeBlock('paragraph', text);
    if (block) blocks.push({ block, page: first.page, top: first.y + first.fontSize, fontSize: first.fontSize });
    group = [];
  };
  for (const line of lines) {
    if (group.length && startsNewBlock(group[group.length - 1], line)) flush();
    group.push(line);
  }
  flush();
  return blocks;
}

/** A bookmark's destination may sit this far (in font sizes) below the heading's top. */
const TOP_SLACK = 2;
/** How many blocks from a bookmark's position are searched for its title. */
const SEARCH_BLOCKS = 4;
/** Longer blocks are body text, never a bookmarked heading on their own. */
const MAX_HEADING_LENGTH = 200;

/**
 * Where a paragraph starting with `title` (case and punctuation aside) should be split so the
 * title becomes its own heading, or -1. The split must fall on a word boundary.
 */
function titlePrefixEnd(text: string, title: string): number {
  const key = headingKey(title);
  if (key.length < 3) return -1;
  let matched = 0;
  for (let i = 0; i < text.length; i++) {
    const k = headingKey(text[i]);
    if (!k) continue;
    if (key.slice(matched, matched + k.length) !== k) return -1;
    matched += k.length;
    if (matched === key.length) return /[\p{L}\p{N}]/u.test(text[i + 1] ?? '') ? -1 : i + 1;
  }
  return -1;
}

/**
 * Makes sure each bookmark has a heading where it points: the block there whose text matches
 * the bookmark title becomes a heading at the bookmark's depth (bookmarks take precedence over
 * font-size levels), a paragraph that starts with the title is split, and when nothing matches a
 * heading with the title is inserted at the destination. Never adds a second heading for one spot.
 */
function mergeBookmarks(placed: PlacedBlock[], bookmarks: PdfBookmark[]): Block[] {
  const blocks = placed.map((p) => p.block);
  const before = new Map<number, Block[]>();
  const split = new Map<number, Block>();
  const claimed = new Set<number>();
  const insertedKeys = new Map<number, Set<string>>();

  for (const bm of bookmarks) {
    const title = cleanText(bm.title);
    const key = headingKey(title);
    if (!key) continue;
    const level = Math.min(6, Math.max(1, bm.depth));

    // The first block at or below the destination, on its page or after it.
    let at = placed.findIndex(
      (p) => p.page > bm.page || (p.page === bm.page && (bm.top === null || p.top <= bm.top + TOP_SLACK * p.fontSize)),
    );
    if (at < 0) at = placed.length;

    let match = -1;
    let prefixEnd = -1;
    let duplicate = false;
    for (let i = at; i < Math.min(placed.length, at + SEARCH_BLOCKS); i++) {
      const { page } = placed[i];
      const block = blocks[i];
      if (page > bm.page + 1) break;
      if (claimed.has(i)) {
        // Another bookmark already made this heading: a repeated entry, not a new one.
        if (block.kind === 'heading' && labelsMatch(block.text, title)) {
          duplicate = true;
          break;
        }
        continue;
      }
      if (block.text.length <= MAX_HEADING_LENGTH && labelsMatch(block.text, title)) {
        match = i;
        break;
      }
      if (block.kind === 'paragraph') {
        const end = titlePrefixEnd(block.text, title);
        if (end > 0) {
          match = i;
          prefixEnd = end;
          break;
        }
      }
    }

    if (duplicate) continue;
    if (match >= 0) {
      claimed.add(match);
      const block = blocks[match];
      if (prefixEnd > 0) {
        const rest = block.text.slice(prefixEnd).replace(/^[\s.:;,—–-]+/, '');
        blocks[match] = { kind: 'heading', level, text: block.text.slice(0, prefixEnd).trim() };
        if (rest) split.set(match, { kind: 'paragraph', text: rest });
      } else {
        blocks[match] = { kind: 'heading', level, text: block.text };
      }
      continue;
    }
    // Nothing matched: insert, unless this spot already got a heading with this title.
    const keys = insertedKeys.get(at) ?? new Set<string>();
    if (keys.has(key)) continue;
    keys.add(key);
    insertedKeys.set(at, keys);
    const list = before.get(at) ?? [];
    list.push({ kind: 'heading', level, text: title });
    before.set(at, list);
  }

  const out: Block[] = [];
  blocks.forEach((block, i) => {
    out.push(...(before.get(i) ?? []), block);
    const rest = split.get(i);
    if (rest) out.push(rest);
  });
  out.push(...(before.get(blocks.length) ?? []));
  return out;
}

