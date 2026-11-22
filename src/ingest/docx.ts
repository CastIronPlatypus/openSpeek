import JSZip from 'jszip';
import type { Block, DocumentDraft } from '../types';
import { assertReadable, baseName, makeBlock, truncateTitle } from './text';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DC = 'http://purl.org/dc/elements/1.1/';

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const wAttr = (el: Element | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const wChild = (el: Element | undefined, name: string) =>
  el ? Array.from(el.children).find((c) => c.namespaceURI === W && c.localName === name) : undefined;

/** Heading level from a style's display name ("heading 2", "Title"), as Word names styles in every locale. */
function levelFromStyleName(name: string): number | undefined {
  const lower = name.toLowerCase();
  if (lower === 'title') return 1;
  if (lower === 'subtitle') return 2;
  const m = /^heading\s*(\d)$/.exec(lower);
  return m ? Number(m[1]) : undefined;
}

/** Map style ids (which may be localized, e.g. "berschrift1") to heading levels. */
function headingStyles(stylesXml: string | undefined): Map<string, number> {
  const levels = new Map<string, number>();
  if (!stylesXml) return levels;
  for (const style of Array.from(parseXml(stylesXml).getElementsByTagNameNS(W, 'style'))) {
    const id = wAttr(style, 'styleId');
    const name = wAttr(wChild(style, 'name'), 'val') ?? '';
    const outline = wAttr(wChild(wChild(style, 'pPr'), 'outlineLvl'), 'val');
    const level = levelFromStyleName(name) ?? (outline !== null && Number(outline) < 6 ? Number(outline) + 1 : undefined);
    if (id && level) levels.set(id, level);
  }
  return levels;
}

/** Text of one paragraph, skipping nested paragraphs (text boxes) and duplicate fallback content. */
function paragraphText(p: Element): string {
  let text = '';
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const name = child.localName;
      if (name === 'Fallback' || (name === 'p' && child.namespaceURI === W)) continue;
      if (child.namespaceURI === W) {
        if (name === 't') text += child.textContent ?? '';
        else if (name === 'tab' || name === 'br' || name === 'cr') text += ' ';
        else if (name === 'noBreakHyphen') text += '-';
      }
      walk(child);
    }
  };
  walk(p);
  return text;
}

/** Text boxes appear twice: in the drawing and in its legacy `mc:Fallback` copy. */
function inFallback(el: Element): boolean {
  for (let a = el.parentElement; a; a = a.parentElement) if (a.localName === 'Fallback') return true;
  return false;
}

function paragraphLevel(p: Element, styles: Map<string, number>): number | undefined {
  const pPr = wChild(p, 'pPr');
  const styleId = wAttr(wChild(pPr, 'pStyle'), 'val');
  const fromStyle = styleId ? (styles.get(styleId) ?? levelFromStyleName(styleId.replace(/(\D)(\d)$/, '$1 $2'))) : undefined;
  if (fromStyle) return fromStyle;
  const outline = wAttr(wChild(pPr, 'outlineLvl'), 'val');
  return outline !== null && Number(outline) < 6 ? Number(outline) + 1 : undefined;
}

export async function importDocx(file: File): Promise<DocumentDraft> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as a Word document. It may be damaged.');
  }
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('This is not a Word (.docx) document.');
  const styles = headingStyles(await zip.file('word/styles.xml')?.async('string'));

  const blocks: Block[] = [];
  for (const p of Array.from(parseXml(documentXml).getElementsByTagNameNS(W, 'p'))) {
    if (inFallback(p)) continue;
    const level = paragraphLevel(p, styles);
    const block = makeBlock(level ? 'heading' : 'paragraph', paragraphText(p), level);
    if (block) blocks.push(block);
  }
  assertReadable(blocks, 'This Word document has no readable text.');

  const coreXml = await zip.file('docProps/core.xml')?.async('string');
  const coreTitle = coreXml ? parseXml(coreXml).getElementsByTagNameNS(DC, 'title')[0]?.textContent?.trim() : '';
  const title = coreTitle || blocks.find((b) => b.kind === 'heading')?.text || baseName(file.name);
  return { title: truncateTitle(title), source: { kind: 'docx', fileName: file.name }, blocks };
}
