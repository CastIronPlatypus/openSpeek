import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DocumentDraft } from '../types';
import * as lib from './index';

const draft = (title: string): DocumentDraft => ({
  title,
  source: { kind: 'text' },
  blocks: [
    { kind: 'heading', level: 1, text: 'Heading' },
    { kind: 'paragraph', text: "First sentence here. Second one, isn't it? Third." },
  ],
});

async function clearAll() {
  for (const d of await lib.listDocuments()) await lib.deleteDocument(d.id);
}

describe('library documents', () => {
  beforeEach(clearAll);

  it('adds a document with derived counts and reads it back', async () => {
    const doc = await lib.addDocument(draft('  My doc  '));
    expect(doc).toMatchObject({ title: 'My doc', wordCount: 9, sentenceCount: 4, progress: 0 });
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(await lib.getDocument(doc.id)).toEqual(doc);
    expect(await lib.getDocument('missing')).toBeUndefined();
  });

  it('lists metadata without bodies, newest first', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const a = await lib.addDocument(draft('A'));
    now.mockReturnValue(2000);
    const b = await lib.addDocument(draft('B'));
    expect((await lib.listDocuments()).map((d) => d.title)).toEqual(['B', 'A']);
    now.mockReturnValue(3000);
    await lib.saveProgress(a.id, 1);
    const list = await lib.listDocuments();
    expect(list.map((d) => d.id)).toEqual([a.id, b.id]);
    expect(list[0]).not.toHaveProperty('blocks');
    now.mockRestore();
  });

  it('clamps progress to the sentence range', async () => {
    const doc = await lib.addDocument(draft('P'));
    await lib.saveProgress(doc.id, 99);
    expect((await lib.getDocument(doc.id))?.progress).toBe(3);
    await lib.saveProgress(doc.id, -5);
    expect((await lib.getDocument(doc.id))?.progress).toBe(0);
    await lib.saveProgress(doc.id, 2.7);
    expect((await lib.getDocument(doc.id))?.progress).toBe(2);
    await expect(lib.saveProgress('missing', 1)).resolves.toBeUndefined();
  });

  it('renames with trimming and rejects empty titles', async () => {
    const doc = await lib.addDocument(draft('Old'));
    await lib.renameDocument(doc.id, '  New name ');
    expect((await lib.getDocument(doc.id))?.title).toBe('New name');
    await expect(lib.renameDocument(doc.id, '   ')).rejects.toThrow(/empty/);
  });

  it('deletes both records', async () => {
    const doc = await lib.addDocument(draft('Gone'));
    await lib.deleteDocument(doc.id);
    expect(await lib.getDocument(doc.id)).toBeUndefined();
    expect(await lib.listDocuments()).toEqual([]);
  });
});

describe('library settings', () => {
  beforeEach(async () => {
    await lib.saveSettings(DEFAULT_SETTINGS);
  });

  it('returns defaults and persists merged patches', async () => {
    expect(await lib.loadSettings()).toEqual(DEFAULT_SETTINGS);
    const saved = await lib.saveSettings({ theme: 'dark', autoScroll: false, corsProxy: ' https://p/?u= ' });
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', autoScroll: false, corsProxy: 'https://p/?u=' });
    expect(await lib.loadSettings()).toEqual(saved);
  });

  it('clamps numbers and rejects invalid enums', async () => {
    const s = await lib.saveSettings({ rate: 9, fontSize: 3, theme: 'neon' as never, engine: 'nope' as never });
    expect(s).toMatchObject({ rate: 3, fontSize: 14, theme: 'system', engine: 'phonon' });
    expect(await lib.saveSettings({ rate: 0.1, fontSize: 40.4 })).toMatchObject({ rate: 0.5, fontSize: 32 });
    expect(await lib.saveSettings({ rate: Number.NaN })).toMatchObject({ rate: 0.5 });
  });

  it('accepts valid engines and merges voices per engine', async () => {
    await lib.saveSettings({ engine: 'edge', voices: { ...DEFAULT_SETTINGS.voices, edge: 'en-US-AvaNeural' } });
    const s = await lib.saveSettings({ voices: { phonon: 'Ava' } as never });
    expect(s.engine).toBe('edge');
    expect(s.voices).toEqual({ phonon: 'Ava', 'phonon-server': null, edge: 'en-US-AvaNeural' });
  });

  it('normalises the server URL and keeps the previous value when invalid', async () => {
    expect((await lib.saveSettings({ serverUrl: ' https://speech.example.com/// ' })).serverUrl).toBe('https://speech.example.com');
    expect((await lib.saveSettings({ serverUrl: 'ftp://nope' })).serverUrl).toBe('https://speech.example.com');
    expect((await lib.saveSettings({ serverUrl: 'not a url' })).serverUrl).toBe('https://speech.example.com');
    expect((await lib.saveSettings({ serverUrl: '  ' })).serverUrl).toBe('');
  });
});
