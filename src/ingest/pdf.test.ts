// @vitest-environment node
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { pdfToDraft, readBookmarks, type OutlineNode, type OutlineSource } from './pdf';
import bookmarksPdf from './__fixtures__/bookmarks.pdf?inline';
import noTextPdf from './__fixtures__/no-text.pdf?inline';
import samplePdf from './__fixtures__/sample.pdf?inline';

// Run pdf.js's worker on the main thread, as Node has no web workers.
// @ts-expect-error pdf.js ships no types for its worker module.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

const fixtures = { 'sample.pdf': samplePdf, 'no-text.pdf': noTextPdf, 'bookmarks.pdf': bookmarksPdf };
const fixture = (name: keyof typeof fixtures) =>
  Uint8Array.from(atob(fixtures[name].split(',')[1]), (c) => c.charCodeAt(0));

describe('PDF import (real pdf.js)', () => {
  // sample.pdf: 4 A5 pages printed by Chromium with a running header, a page-number footer,
  // paragraphs that cross page breaks and a soft-hyphenated word broken across lines.
  it('rebuilds headings and paragraphs, dropping headers and page numbers', async () => {
    const draft = await pdfToDraft(pdfjs, fixture('sample.pdf'), 'sample.pdf');
    expect(draft.title).toBe('Sample Reading Document');
    expect(draft.source).toEqual({ kind: 'pdf', fileName: 'sample.pdf' });

    const paragraph = (n: number) =>
      `Paragraph ${n} talks about reading aloud. Text-to-speech engines turn written words into audio, and a good reader keeps the sentences flowing naturally from one line to the next without awkward breaks. This sentence exists to make the paragraph wrap across several lines on the page.`;
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Sample Reading Document' },
      { kind: 'paragraph', text: paragraph(1) },
      { kind: 'paragraph', text: paragraph(2) },
      {
        kind: 'paragraph',
        text: 'The word supercalifragilisticexpialidocious appears here so that an extraordinary hyphenation break is likely.',
      },
      { kind: 'heading', level: 2, text: 'Second Section' },
      { kind: 'paragraph', text: paragraph(3) },
      { kind: 'paragraph', text: paragraph(4) },
      { kind: 'heading', level: 2, text: 'Third Section' },
      { kind: 'paragraph', text: paragraph(5) },
      { kind: 'paragraph', text: paragraph(6) },
      { kind: 'paragraph', text: paragraph(7) },
      { kind: 'paragraph', text: 'Final page text. The end.' },
    ]);
  });

  // bookmarks.pdf: 2 A5 pages printed by Chromium with its document outline. "Background",
  // "Method" and "Results" (h2) and "Earlier work" (h3) are styled at body size, so only the
  // bookmarks reveal them as headings; the title is both large and bookmarked.
  it('turns bookmarks into headings, without duplicating font-size headings', async () => {
    const draft = await pdfToDraft(pdfjs, fixture('bookmarks.pdf'), 'bookmarks.pdf');
    const words = ['river', 'lantern', 'harbour', 'meadow', 'compass', 'orchard', 'glacier'];
    const para = (n: number) =>
      ({ kind: 'paragraph', text: `The ${words[n - 1]} paragraph is ordinary body text number ${n}. It is long enough to wrap onto another line, as the ${words[n - 1]} text usually does.` });
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Bookmarked Report' },
      para(1),
      { kind: 'heading', level: 2, text: 'Background' },
      para(2),
      para(3),
      { kind: 'heading', level: 3, text: 'Earlier work' },
      para(4),
      { kind: 'heading', level: 2, text: 'Method' },
      para(5),
      { kind: 'heading', level: 2, text: 'Results' },
      para(6),
      para(7),
    ]);
  });

  it('reads the same PDF without its outline using font sizes alone, as before', async () => {
    const withoutOutline = {
      ...pdfjs,
      getDocument: (src: Parameters<typeof pdfjs.getDocument>[0]) => {
        const task = pdfjs.getDocument(src);
        const promise = task.promise.then((doc) => Object.assign(doc, { getOutline: async () => null }));
        return { promise, destroy: () => task.destroy() };
      },
    } as unknown as typeof pdfjs;
    const draft = await pdfToDraft(withoutOutline, fixture('bookmarks.pdf'), 'bookmarks.pdf');
    expect(draft.blocks.filter((b) => b.kind === 'heading')).toEqual([{ kind: 'heading', level: 1, text: 'Bookmarked Report' }]);
  });

  it('explains when a PDF has no text layer', async () => {
    await expect(pdfToDraft(pdfjs, fixture('no-text.pdf'), 'scan.pdf')).rejects.toThrow(/no text layer/);
  });

  it('rejects files that are not PDFs', async () => {
    await expect(pdfToDraft(pdfjs, new TextEncoder().encode('hello'), 'x.pdf')).rejects.toThrow(/could not be read as a PDF/);
  });
});

describe('readBookmarks', () => {
  const ref = (num: number) => ({ num, gen: 0 });
  const source = (outline: OutlineNode[] | null): OutlineSource => ({
    getOutline: async () => outline,
    getDestination: async (id) => (id === 'named' ? [ref(30), { name: 'FitH' }, 400] : null),
    getPageIndex: async (r) => {
      if (r.num === 99) throw new Error('bad ref');
      return r.num / 10;
    },
  });

  it('flattens nested entries with depth, page and top', async () => {
    const bookmarks = await readBookmarks(
      source([
        {
          title: 'One',
          dest: [ref(10), { name: 'XYZ' }, 0, 700, null],
          items: [
            { title: 'One.A', dest: 'named' },
            { title: 'Broken', dest: [ref(99), { name: 'Fit' }], items: [{ title: 'Child of broken', dest: [2, { name: 'Fit' }] }] },
          ],
        },
        { title: 'Two', dest: [ref(20), { name: 'Fit' }] },
        { title: 'Unknown name', dest: 'missing' },
      ]),
    );
    expect(bookmarks).toEqual([
      { title: 'One', depth: 1, page: 1, top: 700 },
      { title: 'One.A', depth: 2, page: 3, top: 400 },
      { title: 'Child of broken', depth: 3, page: 2, top: null },
      { title: 'Two', depth: 1, page: 2, top: null },
    ]);
  });

  it('is empty without an outline', async () => {
    expect(await readBookmarks(source(null))).toEqual([]);
    expect(await readBookmarks({ ...source(null), getOutline: () => Promise.reject(new Error('x')) })).toEqual([]);
  });
});
