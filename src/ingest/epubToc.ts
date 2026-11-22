import type { Block } from '../types';
import { cleanText, headingKey, labelsMatch } from './text';

const OPS = 'http://www.idpf.org/2007/ops';
const XHTML = 'http://www.w3.org/1999/xhtml';

/** One entry of an EPUB's table of contents, flattened in reading order. */
export interface TocEntry {
  label: string;
  /** Path inside the zip of the spine document it points to. */
  path: string;
  /** Element id after `#`, or `null` for the document start. */
  fragment: string | null;
  /** Nesting depth, 1 for top-level entries. */
  depth: number;
}

/** Splits an href found in `fromPath` into a zip path and a fragment. */
function target(fromPath: string, href: string): Pick<TocEntry, 'path' | 'fragment'> | null {
  try {
    const url = new URL(href, `http://epub/${fromPath}`);
    if (url.host !== 'epub') return null;
    const fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : '';
    return { path: decodeURIComponent(url.pathname.slice(1)), fragment: fragment || null };
  } catch {
    return null;
  }
}

const childElements = (el: Element, name: string) =>
  Array.from(el.children).filter((c) => c.localName.toLowerCase() === name);

function epubType(el: Element): string {
  return el.getAttributeNS(OPS, 'type') || el.getAttribute('epub:type') || '';
}

/** EPUB 3: the `<nav epub:type="toc">` of the navigation document (else its first untyped nav). */
export function parseNavToc(doc: Document, navPath: string): TocEntry[] {
  const navs = Array.from(doc.getElementsByTagNameNS('*', 'nav'));
  const nav =
    navs.find((n) => epubType(n).split(/\s+/).includes('toc')) ?? navs.find((n) => !epubType(n));
  const list = nav && childElements(nav, 'ol')[0];
  if (!list) return [];
  const entries: TocEntry[] = [];
  const walk = (ol: Element, depth: number) => {
    for (const li of childElements(ol, 'li')) {
      const link = childElements(li, 'a')[0];
      const labelEl = link ?? childElements(li, 'span')[0];
      const label = cleanText(labelEl?.textContent ?? '');
      const href = link?.getAttribute('href');
      const to = href ? target(navPath, href) : null;
      if (label && to) entries.push({ label, ...to, depth });
      const nested = childElements(li, 'ol')[0];
      if (nested) walk(nested, depth + 1);
    }
  };
  walk(list, 1);
  return entries;
}

/** EPUB 2: the `navMap` of `toc.ncx`. */
export function parseNcxToc(doc: Document, ncxPath: string): TocEntry[] {
  const map = doc.getElementsByTagNameNS('*', 'navMap')[0];
  if (!map) return [];
  const entries: TocEntry[] = [];
  const walk = (parent: Element, depth: number) => {
    for (const point of childElements(parent, 'navpoint')) {
      const labelEl = childElements(point, 'navlabel')[0];
      const label = cleanText((labelEl && childElements(labelEl, 'text')[0]?.textContent) ?? labelEl?.textContent ?? '');
      const src = childElements(point, 'content')[0]?.getAttribute('src');
      const to = src ? target(ncxPath, src) : null;
      if (label && to) entries.push({ label, ...to, depth });
      walk(point, depth + 1);
    }
  };
  walk(map, 1);
  return entries;
}

// ───────── Turning entries into headings ─────────
//
// An entry becomes a marker heading (its label behind a private-use prefix that carries the entry
// index) placed where it points: before the anchor's block element, or at the document start.
// After conversion to blocks, `resolveTocHeadings` keeps a marker only where the text does not
// already have that heading.

const MARKER = /^(\d+)/;

function markerText(index: number, label: string): string {
  return `${index}${label}`;
}

/** A marker heading block for an entry, or `null` when its label has nothing to speak. */
export function markerBlock(index: number, entry: TocEntry): Block | null {
  if (!/[\p{L}\p{N}]/u.test(entry.label)) return null;
  return { kind: 'heading', level: Math.min(6, entry.depth), text: markerText(index, entry.label) };
}

const BLOCKISH = /^(address|article|aside|blockquote|dd|details|div|dl|dt|figure|h[1-6]|header|hgroup|li|main|ol|p|pre|section|table|ul)$/;

/**
 * Puts a marker heading before the element `fragment` names. Returns false when the anchor is
 * not in the document, so the caller can attach the entry to the document start instead.
 */
export function insertFragmentMarker(doc: Document, root: Element, fragment: string, index: number, entry: TocEntry): boolean {
  const anchor =
    doc.getElementById(fragment) ??
    Array.from(root.querySelectorAll('[id], a[name]')).find((el) => el.id === fragment || el.getAttribute('name') === fragment);
  if (!anchor || !root.contains(anchor) || anchor === root) return false;
  if (!/[\p{L}\p{N}]/u.test(entry.label)) return true;
  // An inline anchor (e.g. an empty <a id> inside a paragraph) marks the block it sits in.
  let at: Element = anchor;
  for (let el: Element | null = anchor; el && el !== root; el = el.parentElement) {
    if (BLOCKISH.test(el.localName.toLowerCase())) {
      at = el;
      break;
    }
  }
  // Inside a heading or a list item, start before the outermost such ancestor.
  for (let el = at.parentElement; el && el !== root; el = el.parentElement) {
    if (/^(h[1-6]|li|p)$/.test(el.localName.toLowerCase())) at = el;
  }
  const heading = doc.createElementNS(root.namespaceURI ?? XHTML, `h${Math.min(6, entry.depth)}`);
  heading.textContent = markerText(index, entry.label);
  at.parentNode?.insertBefore(heading, at);
  return true;
}

/** Blocks this short may be a chapter label or title (e.g. "Chapter 1", "The Beginning"). */
const SHORT = 120;
/** How many leading blocks after a marker are compared with its label. */
const WINDOW = 3;

function joinTitle(a: string, b: string): string {
  return /[.:;!?—–-]$/.test(a) ? `${a} ${b}` : `${a}: ${b}`;
}

/**
 * Turns marker headings into real headings where the text lacks them, without duplicating
 * headings the text already has:
 * - text that starts with a heading (right after the marker) keeps it, and the marker is dropped;
 * - a short leading block matching the label (case, spacing and punctuation aside; "Chapter 1.
 *   Loomings" matches "Loomings") is promoted to a heading at the entry's level instead;
 * - two short leading blocks that together make the label ("Chapter 1" + "The Beginning" for
 *   "Chapter 1: The Beginning") become one heading;
 * - otherwise the marker stays, as a heading with the entry's label.
 */
export function resolveTocHeadings(input: Block[]): Block[] {
  const blocks = [...input];
  const out: Block[] = [];
  let i = 0;
  while (i < blocks.length) {
    if (!MARKER.test(blocks[i].text)) {
      out.push(blocks[i++]);
      continue;
    }
    // A run of markers before the same spot, e.g. "Part One" and "Chapter 1".
    const markers: Block[] = [];
    while (i < blocks.length && MARKER.test(blocks[i].text)) markers.push(blocks[i++]);
    const following = blocks.slice(i, i + WINDOW + 1);
    const consumed = new Set<number>();
    const replaced = new Map<number, Block>();
    const kept: Block[] = [];
    for (const marker of markers) {
      const label = marker.text.replace(MARKER, '');
      if (following[0]?.kind === 'heading' && !MARKER.test(following[0].text)) {
        // Already headed: never add a heading in front of an existing one.
        continue;
      }
      let handled = false;
      for (let k = 0; k < Math.min(WINDOW, following.length) && !handled; k++) {
        const block = following[k];
        if (block.text.length > SHORT || MARKER.test(block.text)) break;
        if (consumed.has(k)) continue;
        const next = following[k + 1];
        if (labelsMatch(block.text, label)) {
          if (block.kind === 'paragraph') replaced.set(k, { kind: 'heading', level: marker.level, text: block.text });
          consumed.add(k);
          handled = true;
        } else if (
          next &&
          !consumed.has(k + 1) &&
          next.text.length <= SHORT &&
          headingKey(block.text + next.text) === headingKey(label)
        ) {
          replaced.set(k, { kind: 'heading', level: marker.level, text: joinTitle(block.text, next.text) });
          replaced.set(k + 1, { kind: 'heading', level: 0, text: '' }); // dropped below
          consumed.add(k).add(k + 1);
          handled = true;
        }
      }
      if (!handled) kept.push({ kind: 'heading', level: marker.level, text: label });
    }
    out.push(...kept);
    for (const [k, block] of replaced) blocks[i + k] = block;
  }
  return out.filter((b) => b.text);
}
