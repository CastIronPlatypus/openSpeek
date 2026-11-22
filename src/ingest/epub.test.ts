import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { importFile } from './file';

async function buildEpub(): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Tiny Book</dc:title></metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="c2" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
        <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="style.css" media-type="text/css"/>
      </manifest>
      <spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  const xhtml = (body: string) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;
  zip.file('OEBPS/nav.xhtml', xhtml('<nav><ol><li><a href="text/ch1.xhtml">Chapter 1</a></li></ol></nav>'));
  zip.file('OEBPS/text/ch1.xhtml', xhtml('<h1>Chapter 1</h1><p>It began <i>quietly</i>.</p><p>Then it ended.</p>'));
  // Not well-formed XML (unclosed <br>), as in many real EPUBs.
  zip.file('OEBPS/text/chapter 2.xhtml', '<html><body><h2>Chapter 2</h2><p>Second<br>chapter text.</p></body></html>');
  zip.file('OEBPS/style.css', 'p { margin: 0 }');
  const data = await zip.generateAsync({ type: 'uint8array' });
  return new File([data as Uint8Array<ArrayBuffer>], 'book.epub', { type: 'application/epub+zip' });
}

interface BookSpec {
  /** nav.xhtml body (EPUB 3) and/or toc.ncx navMap content (EPUB 2). */
  nav?: string;
  ncx?: string;
  /** Spine documents: file name (under OEBPS/text/) → body HTML. */
  chapters: Record<string, string>;
}

async function buildBook({ nav, ncx, chapters }: BookSpec): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const names = Object.keys(chapters);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${nav ? '3.0' : '2.0'}">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata>
      <manifest>
        ${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}
        ${ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}
        ${names.map((n, i) => `<item id="c${i}" href="text/${n}" media-type="application/xhtml+xml"/>`).join('')}
      </manifest>
      <spine${ncx ? ' toc="ncx"' : ''}>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  const xhtml = (body: string) =>
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${body}</body></html>`;
  if (nav) zip.file('OEBPS/nav.xhtml', xhtml(nav));
  if (ncx) {
    zip.file(
      'OEBPS/toc.ncx',
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${ncx}</navMap></ncx>`,
    );
  }
  for (const [name, body] of Object.entries(chapters)) zip.file(`OEBPS/text/${name}`, xhtml(body));
  const data = await zip.generateAsync({ type: 'uint8array' });
  return new File([data as Uint8Array<ArrayBuffer>], 'book.epub', { type: 'application/epub+zip' });
}

const navPoint = (id: string, label: string, src: string, children = '') =>
  `<navPoint id="${id}"><navLabel><text>${label}</text></navLabel><content src="${src}"/>${children}</navPoint>`;

describe('EPUB table of contents', () => {
  it('adds headings from a nested EPUB 3 nav to heading-less chapters, including fragment targets', async () => {
    const draft = await importFile(
      await buildBook({
        nav: `<nav epub:type="landmarks"><ol><li><a href="text/one.xhtml">Start here</a></li></ol></nav>
          <nav epub:type="toc"><h1>Contents</h1><ol>
            <li><a href="text/one.xhtml">Part One</a><ol>
              <li><a href="text/one.xhtml#c1">The Arrival</a></li>
              <li><a href="text/one.xhtml#c2">The Departure</a><ol><li><a href="text/one.xhtml#c2-1">A Detour</a></li></ol></li>
            </ol></li>
            <li><a href="text/two.xhtml#missing">Interlude</a></li>
          </ol></nav>`,
        chapters: {
          'one.xhtml': `<p>Opening words.</p><div id="c1"><p>They arrived at dawn.</p></div>
            <p id="c2">They left at dusk.</p><p>On the way, <a id="c2-1"></a>they turned aside.</p>`,
          'two.xhtml': '<p>A pause between parts.</p>',
        },
      }),
    );
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Part One' },
      { kind: 'paragraph', text: 'Opening words.' },
      { kind: 'heading', level: 2, text: 'The Arrival' },
      { kind: 'paragraph', text: 'They arrived at dawn.' },
      { kind: 'heading', level: 2, text: 'The Departure' },
      { kind: 'paragraph', text: 'They left at dusk.' },
      { kind: 'heading', level: 3, text: 'A Detour' },
      { kind: 'paragraph', text: 'On the way, they turned aside.' },
      // The fragment is not in the document, so the entry goes to its start.
      { kind: 'heading', level: 1, text: 'Interlude' },
      { kind: 'paragraph', text: 'A pause between parts.' },
    ]);
  });

  it('falls back to the EPUB 2 NCX', async () => {
    const draft = await importFile(
      await buildBook({
        ncx:
          navPoint('p1', 'Book One', 'text/a.xhtml', navPoint('p2', 'Chapter I', 'text/a.xhtml#ch1') + navPoint('p3', 'Chapter II', 'text/b.xhtml')),
        chapters: {
          'a.xhtml': '<section id="ch1"><p>First chapter text.</p></section>',
          'b.xhtml': '<p>Second chapter text.</p>',
        },
      }),
    );
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Book One' },
      { kind: 'heading', level: 2, text: 'Chapter I' },
      { kind: 'paragraph', text: 'First chapter text.' },
      { kind: 'heading', level: 2, text: 'Chapter II' },
      { kind: 'paragraph', text: 'Second chapter text.' },
    ]);
  });

  it('does not duplicate headings the chapters already have', async () => {
    const draft = await importFile(
      await buildBook({
        nav: `<nav epub:type="toc"><ol>
          <li><a href="text/a.xhtml">chapter one!</a></li>
          <li><a href="text/b.xhtml">Chapter 2: The Beginning</a></li>
          <li><a href="text/c.xhtml">Chapter 3</a></li>
          <li><a href="text/d.xhtml">The Middle</a></li>
          <li><a href="text/e.xhtml">Loomings</a></li>
          <li><a href="text/e.xhtml#s2">The Carpet-Bag</a></li>
        </ol></nav>`,
        chapters: {
          'a.xhtml': '<h2>Chapter One</h2><p>Text a.</p>',
          'b.xhtml': '<p class="num">Chapter 2</p><h2>The Beginning</h2><p>Text b.</p>',
          'c.xhtml': '<p>CHAPTER 3</p><h2>The End</h2><p>Text c.</p>',
          'd.xhtml': '<p>Chapter 4</p><h2>The Middle</h2><p>Text d.</p>',
          'e.xhtml': '<p>Chapter 1. Loomings.</p><p>Call me Ishmael.</p><section id="s2"><h3>The Carpet-Bag</h3><p>Text e.</p></section>',
        },
      }),
    );
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Chapter One' },
      { kind: 'paragraph', text: 'Text a.' },
      // "Chapter 2" + "The Beginning" make up the label: one heading, not three.
      { kind: 'heading', level: 1, text: 'Chapter 2: The Beginning' },
      { kind: 'paragraph', text: 'Text b.' },
      // The label matches the leading "CHAPTER 3": it becomes the heading.
      { kind: 'heading', level: 1, text: 'CHAPTER 3' },
      { kind: 'heading', level: 2, text: 'The End' },
      { kind: 'paragraph', text: 'Text c.' },
      // The label matches the existing heading after "Chapter 4".
      { kind: 'paragraph', text: 'Chapter 4' },
      { kind: 'heading', level: 2, text: 'The Middle' },
      { kind: 'paragraph', text: 'Text d.' },
      { kind: 'heading', level: 1, text: 'Chapter 1. Loomings.' },
      { kind: 'paragraph', text: 'Call me Ishmael.' },
      { kind: 'heading', level: 3, text: 'The Carpet-Bag' },
      { kind: 'paragraph', text: 'Text e.' },
    ]);
  });

  it('ignores a TOC that cannot be read', async () => {
    const draft = await importFile(
      await buildBook({ ncx: '<navPoint><broken', chapters: { 'a.xhtml': '<p>Only text.</p>' } }),
    );
    expect(draft.blocks).toEqual([{ kind: 'paragraph', text: 'Only text.' }]);
  });
});

describe('EPUB import', () => {
  it('reads chapters in spine order with the OPF title', async () => {
    const draft = await importFile(await buildEpub());
    expect(draft.title).toBe('A Tiny Book');
    expect(draft.source).toEqual({ kind: 'epub', fileName: 'book.epub' });
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Chapter 1' },
      { kind: 'paragraph', text: 'It began quietly.' },
      { kind: 'paragraph', text: 'Then it ended.' },
      { kind: 'heading', level: 2, text: 'Chapter 2' },
      { kind: 'paragraph', text: 'Second chapter text.' },
    ]);
  });

  it('rejects files that are not EPUBs', async () => {
    await expect(importFile(new File(['not a zip'], 'bad.epub'))).rejects.toThrow(/could not be read as an EPUB/);
  });
});
