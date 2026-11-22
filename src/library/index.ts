import { segment } from '../ingest/segment';
import type { DocMeta, DocumentDraft, Settings, StoredDocument } from '../types';
import { openIdbStore } from './idbStore';
import { mergeSettings, settingsFromStored } from './settings';
import { createMemoryStore, type Store } from './store';

let storePromise: Promise<Store> | undefined;

function store(): Promise<Store> {
  storePromise ??= openIdbStore().catch((err: unknown) => {
    console.warn('IndexedDB unavailable; the library will not persist across reloads.', err);
    return createMemoryStore();
  });
  return storePromise;
}

function countWords(draft: DocumentDraft): number {
  return draft.blocks.reduce((n, b) => n + (b.text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0), 0);
}

export async function listDocuments(): Promise<DocMeta[]> {
  const all = await (await store()).listMeta();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  const s = await store();
  const [meta, body] = await Promise.all([s.getMeta(id), s.getBody(id)]);
  return meta && body ? { ...meta, blocks: body.blocks } : undefined;
}

export async function addDocument(draft: DocumentDraft): Promise<StoredDocument> {
  const now = Date.now();
  const meta: DocMeta = {
    id: crypto.randomUUID(),
    title: draft.title.trim() || 'Untitled',
    source: draft.source,
    createdAt: now,
    updatedAt: now,
    wordCount: countWords(draft),
    sentenceCount: segment(draft.blocks).length,
    progress: 0,
  };
  await (await store()).putDocument(meta, { id: meta.id, blocks: draft.blocks });
  return { ...meta, blocks: draft.blocks };
}

export async function renameDocument(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('A title cannot be empty.');
  await (await store()).updateMeta(id, (m) => ({ ...m, title: trimmed, updatedAt: Date.now() }));
}

export async function deleteDocument(id: string): Promise<void> {
  await (await store()).deleteDocument(id);
}

export async function saveProgress(id: string, sentenceIndex: number): Promise<void> {
  await (await store()).updateMeta(id, (m) => {
    const index = Number.isFinite(sentenceIndex) ? Math.floor(sentenceIndex) : 0;
    return { ...m, progress: Math.min(Math.max(0, index), Math.max(0, m.sentenceCount - 1)), updatedAt: Date.now() };
  });
}

export async function loadSettings(): Promise<Settings> {
  return settingsFromStored(await (await store()).getSettings());
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = await store();
  const next = mergeSettings(settingsFromStored(await s.getSettings()), patch);
  await s.putSettings(next);
  return next;
}
