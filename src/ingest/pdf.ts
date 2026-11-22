import type { DocumentDraft } from '../types';
import { layoutPages, type PdfItem, type PdfPage } from './pdfLayout';
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
    const blocks = layoutPages(pages);
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
