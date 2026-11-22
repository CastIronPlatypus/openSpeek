import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPaste, isPasteForLibrary, readClipboard, singleUrl } from './paste';

describe('classifyPaste', () => {
  const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

  it('prefers files over anything else on the clipboard', () => {
    expect(classifyPaste({ files: [file], html: '<p>Hi</p>', text: 'Hi' })).toEqual({ kind: 'files', files: [file] });
  });

  it('imports a lone http(s) link as a web page, with or without markup', () => {
    expect(classifyPaste({ text: '  https://example.com/article?id=1 \n' })).toEqual({
      kind: 'url',
      url: 'https://example.com/article?id=1',
    });
    expect(classifyPaste({ html: '<a href="http://example.com">http://example.com</a>', text: 'http://example.com' })).toEqual({
      kind: 'url',
      url: 'http://example.com',
    });
  });

  it('treats text that merely contains a link, or other schemes, as text', () => {
    expect(classifyPaste({ text: 'Read https://example.com today' }).kind).toBe('text');
    expect(classifyPaste({ text: 'https://a.example https://b.example' }).kind).toBe('text');
    expect(classifyPaste({ text: 'ftp://example.com/file' }).kind).toBe('text');
    expect(classifyPaste({ text: 'example.com' }).kind).toBe('text');
  });

  it('uses rich text when there is HTML with words in it, else plain text', () => {
    expect(classifyPaste({ html: '<h1>Title</h1><p>Body</p>', text: 'Title\nBody' })).toEqual({
      kind: 'html',
      html: '<h1>Title</h1><p>Body</p>',
      text: 'Title\nBody',
    });
    expect(classifyPaste({ html: '<img src="a.png">&nbsp;', text: 'Alt words' })).toEqual({ kind: 'text', text: 'Alt words' });
    expect(classifyPaste({ text: 'Just words.' })).toEqual({ kind: 'text', text: 'Just words.' });
  });

  it('reports an empty clipboard', () => {
    expect(classifyPaste({})).toEqual({ kind: 'empty' });
    expect(classifyPaste({ files: [], html: ' ', text: ' \n\t' })).toEqual({ kind: 'empty' });
  });
});

describe('singleUrl', () => {
  it('accepts only a single, well-formed http(s) URL', () => {
    expect(singleUrl('HTTPS://Example.com/x')).toBe('HTTPS://Example.com/x');
    expect(singleUrl('https://')).toBeNull();
    expect(singleUrl('https://exa mple.com')).toBeNull();
    expect(singleUrl('')).toBeNull();
  });
});

describe('readClipboard', () => {
  const item = (types: Record<string, string>) => ({
    types: Object.keys(types),
    getType: async (t: string) => new Blob([types[t]], { type: t }),
  });

  it('reads HTML and plain text with read()', async () => {
    const clipboard = { read: async () => [item({ 'text/html': '<h1>T</h1>', 'text/plain': 'T' })] } as unknown as Clipboard;
    expect(await readClipboard(clipboard)).toEqual({ ok: true, data: { html: '<h1>T</h1>', text: 'T' } });
  });

  it('falls back to readText() when read() is missing or fails for another reason', async () => {
    const readText = async () => 'plain';
    expect(await readClipboard({ readText } as unknown as Clipboard)).toEqual({ ok: true, data: { text: 'plain' } });
    const broken = { read: () => Promise.reject(new TypeError('nope')), readText } as unknown as Clipboard;
    expect(await readClipboard(broken)).toEqual({ ok: true, data: { text: 'plain' } });
  });

  it('reports a refusal or a missing API without throwing', async () => {
    const readText = vi.fn(async () => 'x');
    const denied = {
      read: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      readText,
    } as unknown as Clipboard;
    expect(await readClipboard(denied)).toEqual({ ok: false });
    expect(readText).not.toHaveBeenCalled();
    expect(await readClipboard(undefined)).toEqual({ ok: false });
    expect(await readClipboard({ readText: () => Promise.reject(new Error('no')) } as unknown as Clipboard)).toEqual({ ok: false });
  });
});

describe('isPasteForLibrary', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores pastes into fields, editable content and open dialogs', () => {
    document.body.innerHTML =
      '<input id="i"><textarea id="t"></textarea><div id="e" contenteditable="true"></div><button id="b"></button>';
    const el = (id: string) => document.getElementById(id);
    expect(isPasteForLibrary(document.body)).toBe(true);
    expect(isPasteForLibrary(el('b'))).toBe(true);
    expect(isPasteForLibrary(el('i'))).toBe(false);
    expect(isPasteForLibrary(el('t'))).toBe(false);
    expect(isPasteForLibrary(el('e'))).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<dialog open></dialog>');
    expect(isPasteForLibrary(document.body)).toBe(false);
  });
});
