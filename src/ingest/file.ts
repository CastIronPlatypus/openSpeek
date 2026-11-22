import type { DocumentDraft } from '../types';
import { importDocx } from './docx';
import { importEpub } from './epub';
import { extractArticle } from './html';
import { markdownToBlocks } from './markdown';
import { assertReadable, baseName, importText, truncateTitle } from './text';

/** For `<input type="file" accept>`. */
export const ACCEPTED_FILE_TYPES = [
  '.txt', '.md', '.markdown', '.pdf', '.epub', '.docx', '.html', '.htm',
  'text/plain', 'text/markdown', 'text/html', 'application/pdf', 'application/epub+zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

type Kind = 'text' | 'markdown' | 'pdf' | 'epub' | 'docx' | 'html';

const BY_EXTENSION: Record<string, Kind> = {
  txt: 'text', text: 'text', md: 'markdown', markdown: 'markdown', pdf: 'pdf', epub: 'epub', docx: 'docx', html: 'html', htm: 'html', xhtml: 'html',
};

const BY_MIME: Record<string, Kind> = {
  'text/plain': 'text',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
};

function detectKind(file: File): Kind | undefined {
  const ext = /\.([^./\\]+)$/.exec(file.name)?.[1]?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || BY_MIME[file.type.split(';')[0].toLowerCase()];
}

export async function importFile(file: File): Promise<DocumentDraft> {
  const fileName = file.name;
  switch (detectKind(file)) {
    case 'text': {
      const draft = importText(await file.text());
      return { ...draft, source: { kind: 'text', fileName } };
    }
    case 'markdown': {
      const blocks = markdownToBlocks(await file.text());
      assertReadable(blocks, 'This Markdown file has no readable text.');
      const title = blocks.find((b) => b.kind === 'heading')?.text ?? baseName(fileName);
      return { title: truncateTitle(title), source: { kind: 'markdown', fileName }, blocks };
    }
    case 'pdf': {
      const { importPdf } = await import('./pdf');
      return importPdf(file);
    }
    case 'epub':
      return importEpub(file);
    case 'docx':
      return importDocx(file);
    case 'html': {
      const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
      const { title, blocks } = extractArticle(doc);
      assertReadable(blocks, 'This web page has no readable text.');
      return { title: truncateTitle(title || baseName(fileName)), source: { kind: 'html', fileName }, blocks };
    }
    default: {
      const ext = /\.([^.]+)$/.exec(fileName)?.[1];
      const what = ext ? `.${ext} files` : 'this kind of file';
      throw new Error(`openSpeek can't read ${what}. Supported formats: text, Markdown, PDF, EPUB, Word (.docx) and HTML.`);
    }
  }
}
