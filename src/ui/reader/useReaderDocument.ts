import { useEffect, useState } from 'react';
import type { Sentence, StoredDocument } from '../../types';
import { useApp } from '../appModel';
import { errorMessage } from '../library/useImports';

export type ReaderDocument =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: StoredDocument; sentences: Sentence[] };

/** Loads and segments the document, hands it to the player, and stops the player on leave. */
export function useReaderDocument(id: string): ReaderDocument {
  const model = useApp();
  const [state, setState] = useState<ReaderDocument>({ status: 'loading' });

  useEffect(() => {
    const { player, library, ingest } = model.services;
    let cancelled = false;
    library.getDocument(id).then(
      (doc) => {
        if (cancelled) return;
        if (!doc) {
          setState({ status: 'missing' });
          return;
        }
        const sentences = ingest.segment(doc.blocks);
        const start = Math.min(Math.max(0, doc.progress), Math.max(0, sentences.length - 1));
        player.setDocument(sentences, start);
        model.ensureUsableEngine();
        model.syncPlayer();
        setState({ status: 'ready', doc, sentences });
      },
      (err: unknown) => !cancelled && setState({ status: 'error', message: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
      player.stop();
    };
  }, [id, model]);

  return state;
}
