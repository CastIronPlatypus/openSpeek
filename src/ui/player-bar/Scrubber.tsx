import { useState, type CSSProperties } from 'react';
import { useApp } from '../appModel';
import { formatClock } from '../format';
import { usePlayerState } from '../reader/usePlayerState';

/** Seek bar over sentences. Seeks when the drag (or key press) ends, not on every step. */
export function Scrubber({ count }: { count: number }) {
  const { player } = useApp().services;
  const index = usePlayerState((s) => s.sentenceIndex);
  const elapsed = usePlayerState((s) => s.elapsed);
  const duration = usePlayerState((s) => s.duration);
  const rate = usePlayerState((s) => s.rate);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const max = Math.max(0, count - 1);
  const value = dragValue ?? Math.max(0, index);
  const fill = max > 0 ? (value / max) * 100 : 0;
  const shownElapsed = dragValue === null ? elapsed : (duration * dragValue) / Math.max(1, count);
  const remaining = Math.max(0, duration - shownElapsed) / rate;

  const commit = () => {
    if (dragValue === null) return;
    player.seek(dragValue);
    setDragValue(null);
  };

  return (
    <div className="scrubber">
      <span className="scrubber-time" aria-label="Elapsed">
        {formatClock(shownElapsed)}
      </span>
      <input
        type="range"
        className="scrubber-input"
        aria-label="Position"
        aria-valuetext={`Sentence ${value + 1} of ${count}`}
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={count === 0}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => setDragValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="scrubber-time scrubber-time--end" aria-label={`Remaining at ${rate}×`}>
        −{formatClock(remaining)}
      </span>
    </div>
  );
}
