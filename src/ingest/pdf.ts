import type { DocumentDraft } from '../types';
import { layoutPages, type PdfBookmark, type PdfItem, type PdfPage } from './pdfLayout';
import { assertReadable, baseName, truncateTitle } from './text';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | undefined;

/**
 * Load pdf.js on first use so it stays out of the main bundle. The legacy build is used
 * because the modern one needs very recent APIs (Map#getOrInsertComputed, Math.sumPrecise…)
 * that many browsers in use still lack.
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  return pdfjsPromise;
}

/** Metadata titles are often junk ("Microsoft Word - draft.docx", "untitled"). */
function sensibleTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined;
  const t = title.trim();
  if (t.length < 3 || /^(untitled|document\d*|microsoft word\b.*)$/i.test(t) || /\.\w{2,4}$/.test(t)) return undefined;
  return t;
}

/** The parts of a pdf.js document that bookmarks need (a fake can stand in for tests). */
export interface OutlineSource {
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

export interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
}

/** Bookmarks beyond this many are ignored. */
const MAX_BOOKMARKS = 5000;

/** The top coordinate of an explicit destination `[page, {name}, ...args]`, when it has one. */
function destinationTop(dest: unknown[]): number | null {
  const kind = (dest[1] as { name?: string } | null)?.name;
  const value = kind === 'XYZ' ? dest[3] : kind === 'FitH' || kind === 'FitBH' ? dest[2] : kind === 'FitR' ? dest[5] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Flattens the outline in reading order, resolving each entry to a page and position. Never throws. */
export async function readBookmarks(doc: OutlineSource): Promise<PdfBookmark[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const out: PdfBookmark[] = [];
  const walk = async (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      if (out.length >= MAX_BOOKMARKS) return;
      try {
        const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest;
        const ref = dest?.[0];
        const page =
          typeof ref === 'number' ? ref : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as { num: number; gen: number }) : -1;
        if (dest && page >= 0 && typeof node.title === 'string') out.push({ title: node.title, depth, page, top: destinationTop(dest) });
      } catch {
        // An unresolvable destination: skip this entry, keep its children.
      }
      if (node.items?.length) await walk(node.items, depth + 1);
    }
  };
  await walk(outline, 1);
  return out;
}

/** Extract a draft from PDF bytes with the given pdf.js module (injected so tests can use Node's build). */
export async function pdfToDraft(pdfjs: PdfJs, data: Uint8Array, fileName: string): Promise<DocumentDraft> {
  const task = pdfjs.getDocument({ data });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('This file could not be read as a PDF. It may be damaged.');
  }
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const [, , c, d, x, y] = item.transform as number[];
        items.push({ str: item.str, x, y, width: item.width, fontSize: Math.hypot(c, d) || item.height });
      }
      pages.push({ items });
      page.cleanup();
    }
    const blocks = layoutPages(pages, await readBookmarks(doc as unknown as OutlineSource));
    assertReadable(
      blocks,
      'This PDF has no text layer (it is probably a scanned image), so there is nothing to read aloud. Run it through OCR first.',
    );
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info as { Title?: unknown } | undefined;
    const title = sensibleTitle(info?.Title) ?? blocks.find((b) => b.kind === 'heading')?.text ?? baseName(fileName);
    return { title: truncateTitle(title), source: { kind: 'pdf', fileName }, blocks };
  } finally {
    await task.destroy();
  }
}

export async function importPdf(file: File): Promise<DocumentDraft> {
  const pdfjs = await loadPdfJs();
  return pdfToDraft(pdfjs, new Uint8Array(await file.arrayBuffer()), file.name);
}
