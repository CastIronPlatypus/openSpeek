import { describe, expect, it } from 'vitest';
import { createDraftStore, EMPTY_DRAFT, parseDraft } from './draft';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe('feedback draft', () => {
  it('parses what it stored and ignores junk', () => {
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    expect(parseDraft('{oops')).toEqual(EMPTY_DRAFT);
    expect(parseDraft('{"message":"hi","category":"nope","contact":3}')).toEqual({ message: 'hi', category: 'other', contact: '' });
    expect(parseDraft('{"message":"hi","category":"bug","contact":"me"}')).toEqual({ message: 'hi', category: 'bug', contact: 'me' });
  });

  it('survives a reload through storage and is removed once cleared', () => {
    const storage = memoryStorage();
    const first = createDraftStore(() => storage);
    first.set({ message: 'Half-written', category: 'idea', contact: '' });
    expect(createDraftStore(() => storage).get()).toEqual({ message: 'Half-written', category: 'idea', contact: '' });
    first.set(EMPTY_DRAFT);
    expect(storage.length).toBe(0);
  });

  it('works in memory when storage throws', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    const store = createDraftStore(broken);
    store.set({ message: 'still here', category: 'other', contact: '' });
    expect(store.get().message).toBe('still here');
  });
});
