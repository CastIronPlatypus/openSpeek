import { MAX_RATE, MIN_RATE, useApp, useSettings } from '../appModel';
import { Popover } from '../common/Popover';
import { formatRate } from '../format';

export const RATE_STEP = 0.1;
const PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function SpeedControl() {
  const model = useApp();
  const [{ rate }] = useSettings();

  return (
    <Popover
      label={`Speed ${formatRate(rate)}`}
      buttonContent={<span className="speed-label">{formatRate(rate)}</span>}
      buttonClassName="icon-btn speed-btn"
      title="Speed"
      align="start"
      panelClassName="speed-panel"
    >
      {() => (
        <>
          <div className="speed-stepper">
            <button
              type="button"
              className="icon-btn stepper-btn"
              aria-label="Slower"
              disabled={rate <= MIN_RATE}
              onClick={() => model.setRate(rate - RATE_STEP)}
            >
              −
            </button>
            <output className="speed-value" aria-live="polite">
              {formatRate(rate)}
            </output>
            <button
              type="button"
              className="icon-btn stepper-btn"
              aria-label="Faster"
              disabled={rate >= MAX_RATE}
              onClick={() => model.setRate(rate + RATE_STEP)}
            >
              +
            </button>
          </div>
          <input
            type="range"
            className="speed-slider"
            aria-label="Speed"
            min={MIN_RATE}
            max={MAX_RATE}
            step={0.05}
            value={rate}
            onChange={(e) => model.setRate(Number(e.target.value))}
          />
          <div className="chips" role="group" aria-label="Speed presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={Math.abs(rate - p) < 0.001}
                onClick={() => model.setRate(p)}
              >
                {formatRate(p)}
              </button>
            ))}
          </div>
        </>
      )}
    </Popover>
  );
}
