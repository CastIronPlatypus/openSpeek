import { useSyncExternalStore } from 'react';

export type Route = { view: 'library' } | { view: 'read'; id: string };

function parse(hash: string): Route {
  const match = /^#\/read\/(.+)$/.exec(hash);
  return match ? { view: 'read', id: decodeURIComponent(match[1]) } : { view: 'library' };
}

const subscribe = (listener: () => void) => {
  addEventListener('hashchange', listener);
  return () => removeEventListener('hashchange', listener);
};

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  // `parse` is cheap and the result is only compared field by field.
  return parse(hash);
}

export const readerHref = (id: string) => `#/read/${encodeURIComponent(id)}`;

export function openReader(id: string) {
  location.hash = readerHref(id);
}

export function openLibrary() {
  location.hash = '#/';
}
