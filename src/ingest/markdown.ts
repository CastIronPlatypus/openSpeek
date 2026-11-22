import type { Block } from '../types';
import { makeBlock } from './text';

/** Remove inline Markdown/HTML syntax, keeping the readable text. */
export function stripInline(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1');
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;
const QUOTE = /^\s{0,3}(>\s?)+/;
const LINK_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

/** Light Markdown parser: headings and paragraphs only; code blocks are dropped. */
export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let fence: string | null = null;

  const push = (block: Block | null) => {
    if (block) blocks.push(block);
  };
  const flush = () => {
    if (paragraph.length) push(makeBlock('paragraph', stripInline(paragraph.join(' '))));
    paragraph = [];
  };

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = FENCE.exec(rawLine);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      continue;
    }

    const line = rawLine.replace(QUOTE, '');
    const heading = ATX.exec(line);
    if (heading) {
      flush();
      push(makeBlock('heading', stripInline(heading[2]), heading[1].length));
    } else if (paragraph.length === 1 && SETEXT.test(line)) {
      // "===" or "---" under a single text line is a setext heading, not a rule.
      push(makeBlock('heading', stripInline(paragraph[0]), line.trim()[0] === '=' ? 1 : 2));
      paragraph = [];
    } else if (!line.trim() || RULE.test(line) || LINK_DEFINITION.test(line) || TABLE_DIVIDER.test(line)) {
      flush();
    } else if (LIST.test(line)) {
      flush();
      paragraph.push(line.replace(LIST, ''));
    } else {
      paragraph.push(line.replace(/\|/g, ' '));
    }
  }
  flush();
  return blocks;
}
