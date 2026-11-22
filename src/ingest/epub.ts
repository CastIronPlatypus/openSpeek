import JSZip from 'jszip';
import type { Block, DocumentDraft } from '../types';
import { insertFragmentMarker, markerBlock, parseNavToc, parseNcxToc, resolveTocHeadings, type TocEntry } from './epubToc';
import { htmlToBlocks } from './html';
import { assertReadable, baseName, truncateTitle } from './text';

const DC = 'http://purl.org/dc/elements/1.1/';

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

/** XHTML parsing is strict; many EPUBs are sloppy, so fall back to the forgiving HTML parser. */
function parseXhtml(source: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  return doc.getElementsByTagName('parsererror').length ? new DOMParser().parseFromString(source, 'text/html') : doc;
}

/** Resolve an href found in `fromPath` to a path inside the zip. */
function resolvePath(fromPath: string, href: string): string {
  return decodeURIComponent(new URL(href, `http://epub/${fromPath}`).pathname.slice(1));
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`This EPUB is incomplete (missing ${path}).`);
  return entry.async('string');
}

interface ManifestItem {
  href: string;
  type: string;
  properties: string;
}

/** The book's table of contents: the EPUB 3 navigation document, else the EPUB 2 NCX. Never throws. */
async function readToc(zip: JSZip, opf: Document, opfPath: string, manifest: Map<string, ManifestItem>): Promise<TocEntry[]> {
  const items = [...manifest.values()];
  const nav = items.find((i) => i.properties.split(/\s+/).includes('nav'));
  if (nav) {
    try {
      const path = resolvePath(opfPath, nav.href);
      const entries = parseNavToc(parseXhtml(await readText(zip, path)), path);
      if (entries.length) return entries;
    } catch {
      // Fall through to the NCX.
    }
  }
  const spineToc = opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc');
  const ncx = (spineToc && manifest.get(spineToc)) || items.find((i) => i.type === 'application/x-dtbncx+xml');
  if (ncx) {
    try {
      const path = resolvePath(opfPath, ncx.href);
      return parseNcxToc(parseXml(await readText(zip, path)), path);
    } catch {
      // No usable TOC.
    }
  }
  return [];
}

export async function importEpub(file: File): Promise<DocumentDraft> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as an EPUB. It may be damaged.');
  }
  const container = parseXml(await readText(zip, 'META-INF/container.xml'));
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('This EPUB has no package document.');
  const opf = parseXml(await readText(zip, opfPath));

  const manifest = new Map<string, ManifestItem>();
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, { href, type: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '' });
    }
  }

  // TOC entries per spine document, in TOC order, each with its index in the whole TOC.
  const toc = new Map<string, { index: number; entry: TocEntry }[]>();
  (await readToc(zip, opf, opfPath, manifest)).forEach((entry, index) => {
    const list = toc.get(entry.path) ?? [];
    list.push({ index, entry });
    toc.set(entry.path, list);
  });

  const blocks: Block[] = [];
  for (const ref of Array.from(opf.getElementsByTagNameNS('*', 'itemref'))) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item || !/html/.test(item.type)) continue;
    const path = resolvePath(opfPath, item.href);
    const entry = zip.file(path);
    if (!entry) continue;
    const doc = parseXhtml(await entry.async('string'));
    const root = doc.body ?? doc.documentElement;
    const atStart: Block[] = [];
    for (const { index, entry: tocEntry } of toc.get(path) ?? []) {
      if (tocEntry.fragment && insertFragmentMarker(doc, root, tocEntry.fragment, index, tocEntry)) continue;
      const marker = markerBlock(index, tocEntry);
      if (marker) atStart.push(marker);
    }
    const docBlocks = htmlToBlocks(root);
    // A TOC entry for a document with no text (e.g. a cover image) is not worth a heading.
    if (docBlocks.length) blocks.push(...resolveTocHeadings([...atStart, ...docBlocks]));
  }
  assertReadable(blocks, 'This EPUB has no readable text (it may contain only images).');

  const title = opf.getElementsByTagNameNS(DC, 'title')[0]?.textContent?.trim();
  return { title: truncateTitle(title || baseName(file.name)), source: { kind: 'epub', fileName: file.name }, blocks };
}
