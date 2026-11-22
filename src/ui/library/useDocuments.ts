import { useCallback, useEffect, useState } from 'react';
import type { DocMeta } from '../../types';
import { useApp } from '../appModel';

export function useDocuments() {
  const { services } = useApp();
  const { library } = services;
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await library.listDocuments();
      setDocs([...list].sort((a, b) => b.updatedAt - a.updatedAt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDocs((d) => d ?? []);
    }
  }, [library]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rename = useCallback(
    async (id: string, title: string) => {
      setDocs((ds) => ds?.map((d) => (d.id === id ? { ...d, title } : d)) ?? null);
      await library.renameDocument(id, title);
      await refresh();
    },
    [library, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setDocs((ds) => ds?.filter((d) => d.id !== id) ?? null);
      await library.deleteDocument(id);
      await refresh();
    },
    [library, refresh],
  );

  return { docs, error, refresh, rename, remove };
}
