/** What was pasted, from a paste event or the Clipboard API. */
export interface PasteData {
  files?: File[];
  html?: string;
  text?: string;
}

export type PasteAction =
  | { kind: 'files'; files: File[] }
  | { kind: 'url'; url: string }
  | { kind: 'html'; html: string; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'empty' };

/** The text when it is nothing but one http(s) address, else `null`. */
export function singleUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.hostname ? trimmed : null;
  } catch {
    return null;
  }
}

/** Has text worth reading, not just markup (an image, an empty element). */
const hasHtmlText = (html: string) => /[\p{L}\p{N}]/u.test(html.replace(/<[^>]*>|&[a-z#\d]+;/gi, ''));

/**
 * Decides how to add pasted content: files first, then a lone link (imported as a web page,
 * even when it came with markup, as copying a link from a page does), then rich text, then
 * plain text.
 */
export function classifyPaste({ files = [], html = '', text = '' }: PasteData): PasteAction {
  if (files.length) return { kind: 'files', files };
  const url = singleUrl(text);
  if (url) return { kind: 'url', url };
  if (html.trim() && hasHtmlText(html)) return { kind: 'html', html, text };
  if (text.trim()) return { kind: 'text', text };
  return { kind: 'empty' };
}

/** Reads a paste event's clipboard data. */
export function pasteEventData(data: DataTransfer): PasteData {
  return {
    files: Array.from(data.files ?? []),
    html: data.getData('text/html'),
    text: data.getData('text/plain'),
  };
}

const isEmpty = (data: PasteData) => !data.files?.length && !data.html?.trim() && !data.text?.trim();

/** First address in a `text/uri-list` body (comment lines start with `#`). */
function firstUri(list: string): string {
  return list.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? '';
}

/**
 * Collects what the clipboard items hold. A link copied from Safari's address bar or share
 * sheet arrives as `text/uri-list` with no `text/plain`, so that type counts as text too.
 */
async function readItems(items: ClipboardItem[]): Promise<PasteData> {
  const data: PasteData = {};
  const textOf = async (item: ClipboardItem, type: string) => (await item.getType(type)).text();
  for (const item of items) {
    if (!data.html && item.types.includes('text/html')) data.html = await textOf(item, 'text/html');
    if (!data.text && item.types.includes('text/plain')) data.text = await textOf(item, 'text/plain');
    if (!data.text?.trim() && item.types.includes('text/uri-list')) data.text = firstUri(await textOf(item, 'text/uri-list'));
  }
  return data;
}

export type ClipboardReadResult = { ok: true; data: PasteData } | { ok: false };

/**
 * Reads the clipboard with the async Clipboard API, preferring `read()` (which gives HTML)
 * over `readText()`. Call it directly from a click handler: browsers require a user gesture.
 * `{ ok: false }` means the API is missing or the browser or user refused.
 */
export async function readClipboard(clipboard: Clipboard | undefined = navigator.clipboard): Promise<ClipboardReadResult> {
  if (!clipboard) return { ok: false };
  if (typeof clipboard.read === 'function') {
    try {
      const data = await readItems(await clipboard.read());
      // Nothing recognised: `readText` may still see what `read` did not expose.
      if (isEmpty(data) && typeof clipboard.readText === 'function') {
        const text = await clipboard.readText().catch(() => '');
        if (text.trim()) data.text = text;
      }
      return { ok: true, data };
    } catch (err) {
      // Refused: asking again with readText would only prompt again.
      if (err instanceof DOMException && err.name === 'NotAllowedError') return { ok: false };
    }
  }
  if (typeof clipboard.readText === 'function') {
    try {
      return { ok: true, data: { text: await clipboard.readText() } };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

const isEditable = (el: Element | null) =>
  !!el &&
  (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el as HTMLElement).isContentEditable ||
    !!el.closest('[contenteditable]:not([contenteditable="false"])'));

/**
 * Whether a paste should add a document rather than go to a field or a dialog. Judged by the
 * focused element: Chrome may aim the event at a field that only holds a stale selection.
 */
export function isPasteForLibrary(active: Element | null = document.activeElement): boolean {
  return !document.querySelector('dialog[open]') && !isEditable(active);
}
