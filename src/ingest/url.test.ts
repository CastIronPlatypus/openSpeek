import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTED_FILE_TYPES, importFile } from './file';
import { importUrl, normalizeUrl } from './url';

const article = `<html><head><title>Big News About Things - Example Site</title></head><body><nav>Menu</nav><article><h1>Big News</h1>
  ${'<p>Something important happened today, and here are many words describing it in sufficient detail for the reader.</p>'.repeat(5)}
  <p><a href="/more">Read more</a></p></article></body></html>`;

describe('normalizeUrl', () => {
  it('adds https:// when there is no scheme', () => {
    expect(normalizeUrl(' example.com/a ').href).toBe('https://example.com/a');
    expect(normalizeUrl('localhost:8080/x').href).toBe('https://localhost:8080/x');
    expect(normalizeUrl('http://example.com').href).toBe('http://example.com/');
  });
  it('rejects other schemes and garbage', () => {
    expect(() => normalizeUrl('ftp://example.com')).toThrow(/http/);
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow(/http/);
    expect(() => normalizeUrl('')).toThrow(/Enter/);
    expect(() => normalizeUrl('http://')).toThrow(/not a valid/);
  });
});

describe('importUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts the article and resolves through the proxy', async () => {
    const fetchMock = vi.fn(async () => new Response(article, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetchMock);
    const draft = await importUrl('example.com/news', 'https://proxy.test/?url=');
    expect(fetchMock).toHaveBeenCalledWith('https://proxy.test/?url=https%3A%2F%2Fexample.com%2Fnews');
    expect(draft.source).toEqual({ kind: 'web', url: 'https://example.com/news' });
    expect(draft.title).toMatch(/^Big News About Things/);
    expect(draft.blocks.some((b) => b.text.startsWith('Something important happened'))).toBe(true);
    expect(draft.blocks.map((b) => b.text)).not.toContain('Menu');
  });

  it('explains CORS failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(importUrl('https://example.com')).rejects.toThrow(/does not allow.*paste.*CORS proxy in Settings/s);
  });

  it('reports HTTP errors and empty pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(importUrl('https://example.com')).rejects.toThrow(/HTTP 404/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body><nav>x</nav></body></html>', { headers: { 'content-type': 'text/html' } })));
    await expect(importUrl('https://example.com')).rejects.toThrow(/No readable text/);
  });

  it('imports plain-text responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Plain title\n\nBody text.', { headers: { 'content-type': 'text/plain' } })));
    const draft = await importUrl('https://example.com/a.txt');
    expect(draft).toMatchObject({ title: 'Plain title', source: { kind: 'web', url: 'https://example.com/a.txt' } });
  });
});

describe('importFile dispatch', () => {
  it('imports .txt files with the file name recorded', async () => {
    const draft = await importFile(new File(['Hello.\n\nWorld.'], 'hello.txt'));
    expect(draft.source).toEqual({ kind: 'text', fileName: 'hello.txt' });
    expect(draft.blocks).toHaveLength(2);
  });
  it('rejects unknown types with a readable message', async () => {
    await expect(importFile(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/can't read \.jpg files/);
  });
  it('lists accepted types', () => {
    expect(ACCEPTED_FILE_TYPES).toContain('.epub');
    expect(ACCEPTED_FILE_TYPES).toContain('application/pdf');
  });
});
