import JSZip from 'jszip';
import type { Block, DocumentDraft } from '../types';
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

  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, { href, type: item.getAttribute('media-type') ?? '' });
  }

  const blocks: Block[] = [];
  for (const ref of Array.from(opf.getElementsByTagNameNS('*', 'itemref'))) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item || !/html/.test(item.type)) continue;
    const entry = zip.file(resolvePath(opfPath, item.href));
    if (!entry) continue;
    const doc = parseXhtml(await entry.async('string'));
    blocks.push(...htmlToBlocks(doc.body ?? doc.documentElement));
  }
  assertReadable(blocks, 'This EPUB has no readable text (it may contain only images).');

  const title = opf.getElementsByTagNameNS(DC, 'title')[0]?.textContent?.trim();
  return { title: truncateTitle(title || baseName(file.name)), source: { kind: 'epub', fileName: file.name }, blocks };
}
