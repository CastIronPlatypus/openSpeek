import { useCallback, useRef, useState } from 'react';
import type { DocumentDraft, StoredDocument } from '../../types';
import { useApp } from '../appModel';

export interface ImportJob {
  id: number;
  label: string;
  error: string | null;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs importers, saves their drafts to the library, and tracks each run's progress or error. */
export function useImports(onImported: (doc: StoredDocument, open: boolean) => void) {
  const { services } = useApp();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const seq = useRef(0);

  const run = useCallback(
    async (label: string, produce: () => DocumentDraft | Promise<DocumentDraft>, open: boolean): Promise<boolean> => {
      const id = ++seq.current;
      setJobs((js) => [...js, { id, label, error: null }]);
      try {
        const doc = await services.library.addDocument(await produce());
        setJobs((js) => js.filter((j) => j.id !== id));
        onImported(doc, open);
        return true;
      } catch (err) {
        setJobs((js) => js.map((j) => (j.id === id ? { ...j, error: errorMessage(err) } : j)));
        return false;
      }
    },
    [services, onImported],
  );

  const dismiss = useCallback((id: number) => setJobs((js) => js.filter((j) => j.id !== id)), []);

  return { jobs, run, dismiss };
}
