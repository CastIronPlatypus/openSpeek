import { useId } from 'react';
import { useSettings } from '../appModel';
import { DownloadIcon, MoreIcon } from '../common/icons';
import { Popover } from '../common/Popover';
import { Switch } from '../common/Switch';
import { clampFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../reader/fontSize';
import type { ExportState } from '../reader/useAudioExport';

interface MoreMenuProps {
  exportState: ExportState;
  onExport: () => void;
}

export function MoreMenu({ exportState, onExport }: MoreMenuProps) {
  const [{ fontSize, autoScroll }, update] = useSettings();
  const exporting = exportState.phase === 'running';
  const fontLabelId = useId();

  return (
    <Popover label="More options" buttonContent={<MoreIcon />} title="Options" align="end" panelClassName="more-panel">
      {(close) => (
        <>
          <button
            type="button"
            className="menu-item"
            disabled={exporting}
            onClick={() => {
              onExport();
              close();
            }}
          >
            <DownloadIcon />
            <span>
              {exporting ? 'Saving audio…' : 'Download audio'}
              <span className="muted small block">One WAV file of the whole document</span>
            </span>
          </button>
          <div className="menu-row">
            <span id={fontLabelId}>Text size</span>
            <div className="stepper" role="group" aria-labelledby={fontLabelId}>
              <button
                type="button"
                className="icon-btn stepper-btn"
                aria-label="Smaller text"
                disabled={fontSize <= MIN_FONT_SIZE}
                onClick={() => update({ fontSize: clampFontSize(fontSize - 1) })}
              >
                <span className="font-glyph font-glyph--small">A</span>
              </button>
              <output className="stepper-value">{fontSize}px</output>
              <button
                type="button"
                className="icon-btn stepper-btn"
                aria-label="Larger text"
                disabled={fontSize >= MAX_FONT_SIZE}
                onClick={() => update({ fontSize: clampFontSize(fontSize + 1) })}
              >
                <span className="font-glyph">A</span>
              </button>
            </div>
          </div>
          <Switch
            label="Follow along"
            description="Keep the spoken sentence in view"
            checked={autoScroll}
            onChange={(v) => update({ autoScroll: v })}
          />
        </>
      )}
    </Popover>
  );
}
