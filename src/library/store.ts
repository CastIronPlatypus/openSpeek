import type { Block, DocMeta } from '../types';

export interface DocBody {
  id: string;
  blocks: Block[];
}

/** Persistence backend; IndexedDB normally, in-memory when IndexedDB is unavailable. */
export interface Store {
  listMeta(): Promise<DocMeta[]>;
  getMeta(id: string): Promise<DocMeta | undefined>;
  getBody(id: string): Promise<DocBody | undefined>;
  putDocument(meta: DocMeta, body: DocBody): Promise<void>;
  /** Atomically read-modify-write one meta record; no-op when it does not exist. */
  updateMeta(id: string, update: (meta: DocMeta) => DocMeta): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  getSettings(): Promise<unknown>;
  putSettings(settings: unknown): Promise<void>;
}

export function createMemoryStore(): Store {
  const meta = new Map<string, DocMeta>();
  const bodies = new Map<string, DocBody>();
  let settings: unknown;
  // Copies keep callers from mutating stored records, as with IndexedDB's structured clone.
  const copy = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    listMeta: async () => [...meta.values()].map(copy),
    getMeta: async (id) => copy(meta.get(id)),
    getBody: async (id) => copy(bodies.get(id)),
    putDocument: async (m, b) => {
      meta.set(m.id, copy(m));
      bodies.set(b.id, copy(b));
    },
    updateMeta: async (id, update) => {
      const current = meta.get(id);
      if (current) meta.set(id, copy(update(copy(current))));
    },
    deleteDocument: async (id) => {
      meta.delete(id);
      bodies.delete(id);
    },
    getSettings: async () => copy(settings),
    putSettings: async (s) => {
      settings = copy(s);
    },
  };
}
