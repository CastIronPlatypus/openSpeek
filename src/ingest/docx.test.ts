import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { importFile } from './file';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const para = (runs: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

async function buildDocx(withCoreTitle: boolean): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>
      ${para(run('Document Title'), 'Title')}
      ${para(run('Intro'), 'berschrift1')}
      ${para(`${run('Hello ')}<w:r><w:t>wor</w:t></w:r><w:r><w:t>ld.</w:t><w:tab/><w:t>Tabbed</w:t><w:br/><w:t>broken.</w:t></w:r>`)}
      ${para(`<w:r><w:delText>deleted</w:delText><w:instrText>PAGE</w:instrText></w:r>${run('Kept.')}`)}
      ${para(run('Sub section'), 'Heading2')}
      <w:tbl><w:tr><w:tc>${para(run('Cell text.'))}</w:tc></w:tr></w:tbl>
      ${para(`${run('Before box.')}<w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>${para(run('Box text.'))}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${para(run('Box text.'))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>`)}
      ${para('')}
    </w:body></w:document>`,
  );
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="${W}">
      <w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>
      <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
    </w:styles>`,
  );
  if (withCoreTitle) {
    zip.file(
      'docProps/core.xml',
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Core Title</dc:title></cp:coreProperties>`,
    );
  }
  const data = await zip.generateAsync({ type: 'uint8array' });
  return new File([data as Uint8Array<ArrayBuffer>], 'report.docx');
}

describe('DOCX import', () => {
  it('extracts paragraphs, runs, tabs, breaks and headings', async () => {
    const draft = await importFile(await buildDocx(false));
    expect(draft.source).toEqual({ kind: 'docx', fileName: 'report.docx' });
    expect(draft.title).toBe('Document Title');
    expect(draft.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Document Title' },
      { kind: 'heading', level: 1, text: 'Intro' },
      { kind: 'paragraph', text: 'Hello world. Tabbed broken.' },
      { kind: 'paragraph', text: 'Kept.' },
      { kind: 'heading', level: 2, text: 'Sub section' },
      { kind: 'paragraph', text: 'Cell text.' },
      { kind: 'paragraph', text: 'Before box.' },
      { kind: 'paragraph', text: 'Box text.' },
    ]);
  });

  it('prefers the core properties title', async () => {
    expect((await importFile(await buildDocx(true))).title).toBe('Core Title');
  });

  it('rejects zips that are not Word documents', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expect(importFile(new File([data as Uint8Array<ArrayBuffer>], 'x.docx'))).rejects.toThrow(/not a Word/);
  });
});
