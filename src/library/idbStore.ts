import { openDB, type DBSchema } from 'idb';
import type { DocMeta } from '../types';
import type { DocBody, Store } from './store';

const DB_NAME = 'openspeek';
const DB_VERSION = 1;
const SETTINGS_KEY = 'settings';

interface Schema extends DBSchema {
  meta: { key: string; value: DocMeta };
  bodies: { key: string; value: DocBody };
  settings: { key: string; value: unknown };
}

/** Rejects when IndexedDB is missing or refuses to open (e.g. some private browsing modes). */
export async function openIdbStore(): Promise<Store> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
  const db = await openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('bodies', { keyPath: 'id' });
        db.createObjectStore('settings');
      }
    },
  });

  return {
    listMeta: () => db.getAll('meta'),
    getMeta: (id) => db.get('meta', id),
    getBody: (id) => db.get('bodies', id),
    async putDocument(meta, body) {
      const tx = db.transaction(['meta', 'bodies'], 'readwrite');
      await Promise.all([tx.objectStore('meta').put(meta), tx.objectStore('bodies').put(body), tx.done]);
    },
    async updateMeta(id, update) {
      const tx = db.transaction('meta', 'readwrite');
      const current = await tx.store.get(id);
      if (current) await tx.store.put(update(current));
      await tx.done;
    },
    async deleteDocument(id) {
      const tx = db.transaction(['meta', 'bodies'], 'readwrite');
      await Promise.all([tx.objectStore('meta').delete(id), tx.objectStore('bodies').delete(id), tx.done]);
    },
    getSettings: () => db.get('settings', SETTINGS_KEY),
    async putSettings(settings) {
      await db.put('settings', settings, SETTINGS_KEY);
    },
  };
}
