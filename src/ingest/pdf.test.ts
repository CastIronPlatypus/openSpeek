// @vitest-environment node
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { pdfToDraft } from './pdf';
import noTextPdf from './__fixtures__/no-text.pdf?inline';
import samplePdf from './__fixtures__/sample.pdf?inline';

// Run pdf.js's worker on the main thread, as Node has no web workers.
// @ts-expect-error pdf.js ships no types for its worker module.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

const fixtures = { 'sample.pdf': samplePdf, 'no-text.pdf': noTextPdf };
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

  it('explains when a PDF has no text layer', async () => {
    await expect(pdfToDraft(pdfjs, fixture('no-text.pdf'), 'scan.pdf')).rejects.toThrow(/no text layer/);
  });

  it('rejects files that are not PDFs', async () => {
    await expect(pdfToDraft(pdfjs, new TextEncoder().encode('hello'), 'x.pdf')).rejects.toThrow(/could not be read as a PDF/);
  });
});
