import { Readability } from '@mozilla/readability';
import type { Block } from '../types';
import { makeBlock } from './text';

const SKIP = new Set([
  'script', 'style', 'nav', 'aside', 'footer', 'form', 'noscript', 'template', 'head', 'svg', 'math',
  'canvas', 'iframe', 'object', 'embed', 'video', 'audio', 'button', 'select', 'textarea', 'input',
]);

/** Elements that end the current run of inline text. */
const BLOCK = new Set([
  'address', 'article', 'blockquote', 'body', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html',
  'legend', 'li', 'main', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul',
]);

function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style');
  return !!style && /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style);
}

/**
 * Convert a DOM subtree to blocks. Inline text is gathered until the next block-level
 * element, so text in nested blocks is emitted once, by the innermost block.
 */
export function htmlToBlocks(root: Element): Block[] {
  const blocks: Block[] = [];

  const walk = (el: Element, kind: Block['kind'], level: number | undefined, buffer: string[]) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        buffer.push(node.textContent ?? '');
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      const tag = child.localName.toLowerCase();
      if (SKIP.has(tag) || isHidden(child)) continue;
      if (tag === 'br') {
        buffer.push(' ');
      } else if (BLOCK.has(tag)) {
        flush(kind, level, buffer);
        const heading = /^h([1-6])$/.exec(tag);
        walk(child, heading ? 'heading' : 'paragraph', heading ? Number(heading[1]) : undefined, buffer);
        flush(heading ? 'heading' : 'paragraph', heading ? Number(heading[1]) : undefined, buffer);
      } else {
        walk(child, kind, level, buffer);
      }
    }
  };

  const flush = (kind: Block['kind'], level: number | undefined, buffer: string[]) => {
    const block = makeBlock(kind, buffer.join(''), level);
    if (block) blocks.push(block);
    buffer.length = 0;
  };

  const buffer: string[] = [];
  walk(root, 'paragraph', undefined, buffer);
  flush('paragraph', undefined, buffer);
  return blocks;
}

export interface Article {
  title: string;
  blocks: Block[];
}

/**
 * Extract the main content of a page with Readability, falling back to the whole body
 * when Readability finds nothing. Mutates `doc`.
 */
export function extractArticle(doc: Document): Article {
  const fallbackTitle = doc.title;
  const fallbackBody = doc.body ? htmlToBlocks(doc.body) : [];
  const article = new Readability(doc).parse();
  let blocks: Block[] = [];
  if (article?.content) {
    const content = new DOMParser().parseFromString(article.content, 'text/html');
    blocks = htmlToBlocks(content.body);
  }
  if (!blocks.length) blocks = fallbackBody;
  const title = article?.title?.trim() || fallbackTitle.trim();
  // Readability removes the headline from the content; put it back so it is read aloud.
  const headline = makeBlock('heading', title, 1);
  if (headline && blocks.length && blocks[0].text !== headline.text) blocks = [headline, ...blocks];
  return { title, blocks };
}
