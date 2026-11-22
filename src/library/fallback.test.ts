import { expect, it, vi } from 'vitest';
import * as lib from './index';

it('falls back to memory when IndexedDB is unavailable', async () => {
  expect(typeof indexedDB).toBe('undefined');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const doc = await lib.addDocument({ title: 'T', source: { kind: 'text' }, blocks: [{ kind: 'paragraph', text: 'Hello.' }] });
  expect(await lib.getDocument(doc.id)).toEqual(doc);
  expect((await lib.saveSettings({ rate: 2 })).rate).toBe(2);
  expect(warn).toHaveBeenCalledOnce();
});
