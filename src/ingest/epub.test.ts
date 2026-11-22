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
