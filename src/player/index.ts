import { getEngine } from '../tts';
import type { Player } from '../types';
import { ReadAloudPlayer } from './player';

export { ReadAloudPlayer, MIN_RATE, MAX_RATE } from './player';

let player: ReadAloudPlayer | null = null;

export function getPlayer(): Player {
  player ??= new ReadAloudPlayer({
    engines: getEngine,
    createAudio: () => new Audio(),
    mediaSession: 'mediaSession' in navigator ? navigator.mediaSession : undefined,
  });
  return player;
}
