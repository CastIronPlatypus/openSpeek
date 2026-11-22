import { DEFAULT_SETTINGS, type Settings } from '../types';
import type { Library } from './services';
import { createStore, type Store } from './store';

export interface SettingsStore extends Store<Settings> {
  /** Applies a change immediately and persists it shortly after (changes are coalesced). */
  update(patch: Partial<Settings>): void;
}

const PERSIST_DELAY_MS = 300;

export async function createSettingsStore(library: Library): Promise<SettingsStore> {
  let initial: Settings;
  try {
    initial = { ...DEFAULT_SETTINGS, ...(await library.loadSettings()) };
  } catch (err) {
    console.error('Could not load settings', err);
    initial = DEFAULT_SETTINGS;
  }
  const store = createStore(initial);
  let pending: Partial<Settings> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (Object.keys(pending).length === 0) return;
    const patch = pending;
    pending = {};
    library.saveSettings(patch).catch((err: unknown) => console.error('Could not save settings', err));
  };
  addEventListener('pagehide', flush);

  return {
    ...store,
    update(patch) {
      store.set({ ...store.get(), ...patch });
      pending = { ...pending, ...patch };
      clearTimeout(timer);
      timer = setTimeout(flush, PERSIST_DELAY_MS);
    },
  };
}
