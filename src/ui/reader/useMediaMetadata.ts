import { useEffect } from 'react';
import type { SectionHub } from './sectionHub';
import { sectionTitle } from './useSections';

/**
 * Shows the document and the current section on the lock screen and in media notifications.
 * The player owns the media session's actions and playback state; this only sets the metadata,
 * updating it when playback crosses into another section.
 */
export function useMediaMetadata(title: string, hub: SectionHub) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const session = navigator.mediaSession;
    const artwork = [192, 512].map((size) => ({ src: `${import.meta.env.BASE_URL}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' }));
    let shown = Number.NaN;
    const update = () => {
      const current = hub.current();
      if (current === shown) return;
      shown = current;
      const section = hub.sections.length > 1 && current >= 0 ? sectionTitle(hub.sections[current]) : '';
      try {
        session.metadata = new MediaMetadata({ title, artist: section, album: section ? title : '', artwork });
      } catch {
        // Some browsers reject metadata (e.g. artwork they cannot fetch); the lock screen just shows less.
      }
    };
    update();
    const unsubscribe = hub.subscribeCurrent(update);
    return () => {
      unsubscribe();
      session.metadata = null;
    };
  }, [title, hub]);
}
