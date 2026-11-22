import { useCallback, useSyncExternalStore } from 'react';
import type { PlayerState } from '../../types';
import { useApp } from '../appModel';

/**
 * Subscribes to one slice of player state. Components re-render only when the selected value
 * changes, so selectors should return primitives or references the player keeps stable.
 */
export function usePlayerState<T>(select: (s: PlayerState) => T): T {
  const { player } = useApp().services;
  const subscribe = useCallback((listener: () => void) => player.subscribe(listener), [player]);
  return useSyncExternalStore(subscribe, () => select(player.getState()));
}
