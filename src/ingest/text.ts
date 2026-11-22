import type { Block, DocumentDraft } from '../types';

const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/** Strip invisible characters and collapse all whitespace (including NBSP) to single spaces. */
export function cleanText(text: string): string {
  return text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Build a block from raw text, or `null` when nothing readable is left. */
export function makeBlock(kind: Block['kind'], raw: string, level?: number): Block | null {
  const text = cleanText(raw);
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  return kind === 'heading' ? { kind, level: Math.min(6, Math.max(1, level ?? 1)), text } : { kind, text };
}

/** Shorten a title on a word boundary. */
export function truncateTitle(title: string, max = 80): string {
  const clean = cleanText(title);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** File name without its extension, for use as a fallback title. */
export function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || fileName;
}

/** Throw a user-readable error when an import produced nothing to read. */
export function assertReadable(blocks: Block[], message: string): void {
  if (blocks.length === 0) throw new Error(message);
}

const LIST_ITEM = /^\s*([-*•‣◦▪–]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+/i;

/** A short line without trailing punctuation, e.g. a title or section label in plain text. */
function isTitleLike(line: string, longest: number): boolean {
  const t = line.trim();
  return t.length <= 60 && t.length < longest * 0.6 && !/[.,;:!?…"”')\]-]$/.test(t);
}

/** Split one blank-line-separated paragraph into blocks, joining hard-wrapped lines. */
function paragraphBlocks(paragraph: string): Block[] {
  const lines = paragraph.split('\n').filter((l) => l.trim());
  const longest = Math.max(...lines.map((l) => l.trim().length));
  const groups: string[][] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const separate =
      i === 0 || LIST_ITEM.test(line) || isTitleLike(line, longest) || (prev !== undefined && isTitleLike(prev, longest));
    if (separate) groups.push([line]);
    else groups[groups.length - 1].push(line);
  });
  return groups.map((g) => makeBlock('paragraph', g.join(' '))).filter((b): b is Block => b !== null);
}

/** Plain text → blocks: paragraphs split on blank lines. */
export function textToBlocks(text: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t\u00A0]*\n/)
    .flatMap(paragraphBlocks);
}

export function importText(text: string, title?: string): DocumentDraft {
  const blocks = textToBlocks(text);
  assertReadable(blocks, 'There is no readable text to import.');
  const firstLine = text.replace(INVISIBLE, '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  return {
    title: truncateTitle(title?.trim() || firstLine) || 'Untitled',
    source: { kind: 'text' },
    blocks,
  };
}
