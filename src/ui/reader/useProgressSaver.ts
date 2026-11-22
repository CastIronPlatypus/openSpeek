import { useEffect } from 'react';
import { useApp } from '../appModel';

const SAVE_INTERVAL_MS = 2000;

/** Saves the reading position: throttled while playing, and right away on pause, hide and leave. */
export function useProgressSaver(docId: string) {
  const { player, library } = useApp().services;

  useEffect(() => {
    const initial = player.getState();
    // Remember the last real index: by cleanup time the player may already be stopped (index -1).
    let lastIndex = initial.sentenceIndex;
    let lastStatus = initial.status;
    let savedIndex = lastIndex;
    let lastSaveAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      if (lastIndex < 0 || lastIndex === savedIndex) return;
      savedIndex = lastIndex;
      lastSaveAt = Date.now();
      library.saveProgress(docId, lastIndex).catch((err: unknown) => console.error('Could not save progress', err));
    };

    const unsubscribe = player.subscribe(() => {
      const s = player.getState();
      if (s.sentenceIndex >= 0 && s.sentenceIndex !== lastIndex) {
        lastIndex = s.sentenceIndex;
        const wait = SAVE_INTERVAL_MS - (Date.now() - lastSaveAt);
        if (wait <= 0) save();
        else timer ??= setTimeout(save, wait);
      }
      if (s.status !== lastStatus) {
        lastStatus = s.status;
        if (s.status === 'paused' || s.status === 'ended') save();
      }
    });
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unsubscribe();
      removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [docId, player, library]);
}
