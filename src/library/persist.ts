let asked = false;

/**
 * Ask the browser not to evict this site's storage (the library and reading positions).
 * Best effort and at most once per session: browsers may grant it silently, prompt, or refuse.
 * Called when a document is added, since some browsers only grant or prompt after a user action.
 */
export function requestPersistentStorage(): void {
  if (asked) return;
  asked = true;
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.persist) return;
  void storage
    .persisted()
    .then((already) => (already ? true : storage.persist()))
    .catch(() => false);
}
