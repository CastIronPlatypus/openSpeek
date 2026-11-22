import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sentence } from '../../types';
import { useApp } from '../appModel';
import { fileSafeName } from '../format';
import { errorMessage } from '../library/useImports';

export type ExportState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'error'; message: string };

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Renders the whole document to a WAV file, with progress and cancel; cancelled on unmount. */
export function useAudioExport(sentences: Sentence[], title: string) {
  const { player } = useApp().services;
  const [state, setState] = useState<ExportState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(() => {
    if (controller.current) return;
    const ac = new AbortController();
    controller.current = ac;
    setState({ phase: 'running', done: 0, total: sentences.length });
    player
      .exportWav(sentences, {
        signal: ac.signal,
        onProgress: (done, total) => !ac.signal.aborted && setState({ phase: 'running', done, total }),
      })
      .then(
        (blob) => {
          download(blob, `${fileSafeName(title)}.wav`);
          setState({ phase: 'idle' });
        },
        (err: unknown) => {
          const aborted = ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
          setState(aborted ? { phase: 'idle' } : { phase: 'error', message: errorMessage(err) });
        },
      )
      .finally(() => {
        if (controller.current === ac) controller.current = null;
      });
  }, [player, sentences, title]);

  const cancel = useCallback(() => controller.current?.abort(), []);
  const dismiss = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, cancel, dismiss };
}
