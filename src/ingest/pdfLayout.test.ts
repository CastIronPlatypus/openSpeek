import { describe, expect, it } from 'vitest';
import { layoutPages, type PdfItem, type PdfPage } from './pdfLayout';

/** Lay out lines top-down: each entry is [text, fontSize?, x?, extraGapBefore?]. */
function page(lines: [string, number?, number?, number?][], pageNumber?: number): PdfPage {
  const items: PdfItem[] = [{ str: 'Journal of Tests', x: 72, y: 800, width: 100, fontSize: 9 }];
  let y = 760;
  for (const [str, fontSize = 10, x = 72, gap = 0] of lines) {
    y -= gap;
    items.push({ str, x, y, width: str.length * fontSize * 0.5, fontSize });
    y -= fontSize * 1.2;
  }
  if (pageNumber !== undefined) items.push({ str: String(pageNumber), x: 300, y: 40, width: 10, fontSize: 9 });
  return { items };
}

describe('layoutPages', () => {
  it('detects headings, paragraphs, hyphenation and page furniture', () => {
    const long = 'x'.repeat(90);
    const pages = [
      page(
        [
          ['Big Title', 20],
          ['Sub heading', 14, 72, 10],
          [`First paragraph starts ${long} and is exam-`, 10, 72, 6],
          ['ple text that ends here.'],
          [`Second paragraph after a gap ${long} continues`, 10, 72, 8],
          ['onto the next page'],
        ],
        1,
      ),
      page([[`without a break ${long} and finishes.`], ['Indented new paragraph begins here.', 10, 90]], 2),
      page([['Last page.']], 3),
    ];
    expect(layoutPages(pages)).toEqual([
      { kind: 'heading', level: 1, text: 'Big Title' },
      { kind: 'heading', level: 2, text: 'Sub heading' },
      { kind: 'paragraph', text: `First paragraph starts ${long} and is example text that ends here.` },
      { kind: 'paragraph', text: `Second paragraph after a gap ${long} continues onto the next page without a break ${long} and finishes.` },
      { kind: 'paragraph', text: 'Indented new paragraph begins here.' },
      { kind: 'paragraph', text: 'Last page.' },
    ]);
  });

  it('joins items on one line, inserting spaces only at real gaps', () => {
    const items: PdfItem[] = [
      { str: 'Hel', x: 0, y: 100, width: 15, fontSize: 10 },
      { str: 'lo', x: 15, y: 100, width: 10, fontSize: 10 },
      { str: 'world', x: 30, y: 100.5, width: 25, fontSize: 10 },
    ];
    expect(layoutPages([{ items }])).toEqual([{ kind: 'paragraph', text: 'Hello world' }]);
  });

  describe('with bookmarks', () => {
    const long = 'y'.repeat(90);
    const body = (text: string): [string] => [text];
    // Tops (y + size): "Big Title" 780, then 10pt lines every 12 below, plus the extra gaps.
    const pages = [
      page([
        ['Big Title', 20],
        ['Introduction', 10, 72, 10],
        body(`Body text of the introduction ${long}`),
        body(`continues on this line ${long}`),
        body('and ends here.'),
        ['Methods. We describe what was done here.', 10, 72, 10],
        body(`More body ${long}`),
        body(`and more ${long}`),
        body('to the end.'),
      ]),
      page([body(`Second page body ${long}`), body('ends.'), [`Still body ${long}`, 10, 72, 10], body('ends too.')]),
    ];
    const introTop = 760 - 24 - 10 + 10;

    it('promotes matching text, splits a paragraph that starts with the title, and keeps the rest', () => {
      expect(
        layoutPages(pages, [
          { title: 'Big title', depth: 1, page: 0, top: 790 },
          { title: 'INTRODUCTION', depth: 2, page: 0, top: introTop + 2 },
          { title: 'Methods', depth: 2, page: 0, top: null },
        ]),
      ).toEqual([
        { kind: 'heading', level: 1, text: 'Big Title' },
        { kind: 'heading', level: 2, text: 'Introduction' },
        { kind: 'paragraph', text: `Body text of the introduction ${long} continues on this line ${long} and ends here.` },
        { kind: 'heading', level: 2, text: 'Methods' },
        { kind: 'paragraph', text: 'We describe what was done here.' },
        { kind: 'paragraph', text: `More body ${long} and more ${long} to the end.` },
        { kind: 'paragraph', text: `Second page body ${long} ends.` },
        { kind: 'paragraph', text: `Still body ${long} ends too.` },
      ]);
    });

    it('lets bookmark depth override font-size levels', () => {
      const blocks = layoutPages(pages, [{ title: 'Big Title', depth: 3, page: 0, top: null }]);
      expect(blocks[0]).toEqual({ kind: 'heading', level: 3, text: 'Big Title' });
    });

    it('inserts a heading where nothing matches, at the destination', () => {
      const blocks = layoutPages(pages, [
        { title: 'Appendix', depth: 1, page: 1, top: 745 },
        { title: 'Appendix', depth: 1, page: 1, top: 745 },
        { title: 'Afterword', depth: 1, page: 5, top: null },
      ]);
      expect(blocks.slice(-4)).toEqual([
        { kind: 'paragraph', text: `Second page body ${long} ends.` },
        { kind: 'heading', level: 1, text: 'Appendix' },
        { kind: 'paragraph', text: `Still body ${long} ends too.` },
        { kind: 'heading', level: 1, text: 'Afterword' },
      ]);
    });

    it('treats a repeated bookmark for the same heading as one', () => {
      const blocks = layoutPages(pages, [
        { title: 'Introduction', depth: 1, page: 0, top: null },
        { title: 'Introduction', depth: 2, page: 0, top: null },
      ]);
      expect(blocks.filter((b) => b.kind === 'heading')).toEqual([
        { kind: 'heading', level: 1, text: 'Big Title' },
        { kind: 'heading', level: 1, text: 'Introduction' },
      ]);
    });
  });

  it('returns nothing for pages without text', () => {
    expect(layoutPages([{ items: [] }, { items: [{ str: ' ', x: 0, y: 0, width: 1, fontSize: 10 }] }])).toEqual([]);
  });
});
