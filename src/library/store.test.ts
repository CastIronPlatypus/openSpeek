import { describe, expect, it } from 'vitest';
import type { DocMeta } from '../types';
import { createMemoryStore } from './store';

const meta: DocMeta = {
  id: 'a', title: 'T', source: { kind: 'text' }, createdAt: 1, updatedAt: 1, wordCount: 1, sentenceCount: 1, progress: 0,
};

describe('memory store (fallback when IndexedDB is unavailable)', () => {
  it('stores copies and supports the full store API', async () => {
    const store = createMemoryStore();
    const body = { id: 'a', blocks: [{ kind: 'paragraph' as const, text: 'Hi.' }] };
    await store.putDocument(meta, body);
    body.blocks[0].text = 'mutated';
    expect((await store.getBody('a'))?.blocks[0].text).toBe('Hi.');
    await store.updateMeta('a', (m) => ({ ...m, title: 'U' }));
    expect((await store.listMeta()).map((m) => m.title)).toEqual(['U']);
    await store.updateMeta('missing', (m) => m);
    await store.deleteDocument('a');
    expect(await store.getMeta('a')).toBeUndefined();
    await store.putSettings({ rate: 2 });
    expect(await store.getSettings()).toEqual({ rate: 2 });
  });
});
