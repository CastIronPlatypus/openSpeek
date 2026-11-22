import type { DocumentDraft } from '../types';
import { importFile } from './file';
import { extractArticle } from './html';
import { assertReadable, importText, truncateTitle } from './text';

/** Parse user input as an http(s) URL, assuming https:// when no scheme is given. */
export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a web address to import.');
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[^:/]+:\d+(\/|$)/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${trimmed}" is not a valid web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// addresses can be imported.');
  }
  return url;
}

const BLOCKED_MESSAGE =
  'This site does not allow its pages to be fetched directly from a browser. ' +
  'Copy the text and paste it instead, or set up a CORS proxy in Settings.';

export async function importUrl(input: string, corsProxy?: string): Promise<DocumentDraft> {
  const url = normalizeUrl(input);
  const proxy = corsProxy?.trim();
  const target = proxy ? proxy + encodeURIComponent(url.href) : url.href;

  let response: Response;
  try {
    response = await fetch(target);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // A cross-origin refusal surfaces as an opaque network TypeError.
    throw new Error(proxy ? `The page could not be fetched through the CORS proxy (${proxy}).` : BLOCKED_MESSAGE);
  }
  if (!response.ok) throw new Error(`The page could not be downloaded (HTTP ${response.status}).`);

  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (type && !/html|xml/.test(type)) {
    if (type.startsWith('text/plain')) {
      const draft = importText(await response.text());
      return { ...draft, source: { kind: 'web', url: url.href } };
    }
    // PDFs, EPUBs and the like: hand them to the file importer.
    const name = decodeURIComponent(url.pathname.split('/').pop() || 'download');
    const draft = await importFile(new File([await response.blob()], name, { type: type.split(';')[0] }));
    return { ...draft, source: { ...draft.source, url: url.href } };
  }

  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const base = doc.createElement('base');
  base.href = url.href;
  doc.head.prepend(base);

  const { title, blocks } = extractArticle(doc);
  assertReadable(blocks, 'No readable text was found on that page.');
  return { title: truncateTitle(title || url.hostname), source: { kind: 'web', url: url.href }, blocks };
}
