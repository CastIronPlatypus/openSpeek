import { useApp } from '../appModel';
import { PauseIcon, PlayIcon, ReplayIcon } from '../common/icons';
import { usePlayerState } from '../reader/usePlayerState';

const RING_RADIUS = 29;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function PlayButton() {
  const { player } = useApp().services;
  const status = usePlayerState((s) => s.status);
  const fraction = usePlayerState((s) => s.modelProgress?.fraction ?? null);

  const active = status === 'playing' || status === 'buffering' || status === 'loading';
  const ended = status === 'ended';
  const label = ended ? 'Listen again' : status === 'loading' ? 'Loading voice, press to cancel' : active ? 'Pause' : 'Play';

  const onClick = () => {
    if (ended) {
      player.seek(0);
      void player.play();
    } else if (active) player.pause();
    else void player.play();
  };

  return (
    <button
      type="button"
      className="play-btn"
      data-status={status}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {status === 'buffering' && <span className="play-spinner" aria-hidden="true" />}
      {status === 'loading' && (
        <svg className="play-ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle className="play-ring-track" cx="32" cy="32" r={RING_RADIUS} />
          <circle
            className={`play-ring-fill${fraction === null ? ' play-ring-fill--indeterminate' : ''}`}
            cx="32"
            cy="32"
            r={RING_RADIUS}
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={fraction === null ? RING_LENGTH * 0.75 : RING_LENGTH * (1 - fraction)}
          />
        </svg>
      )}
      {ended ? <ReplayIcon size={26} /> : active ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
    </button>
  );
}
