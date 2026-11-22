import type { Ref } from 'react';
import { useApp } from '../appModel';
import { NextIcon, PrevIcon } from '../common/icons';
import type { ExportState } from '../reader/useAudioExport';
import { MoreMenu } from './MoreMenu';
import { PlayButton } from './PlayButton';
import { PlayerNotice } from './PlayerNotice';
import { Scrubber } from './Scrubber';
import { SpeedControl } from './SpeedControl';
import { VoiceControl } from './VoiceControl';
import '../styles/player.css';

interface PlayerBarProps {
  sentenceCount: number;
  exportState: ExportState;
  onExport: () => void;
  onCancelExport: () => void;
  onDismissExport: () => void;
  ref: Ref<HTMLDivElement>;
}

export function PlayerBar({ sentenceCount, exportState, onExport, onCancelExport, onDismissExport, ref }: PlayerBarProps) {
  const { player } = useApp().services;
  return (
    <div className="player-bar" ref={ref} role="region" aria-label="Player">
      <div className="player-inner">
        <PlayerNotice exportState={exportState} onCancelExport={onCancelExport} onDismissExport={onDismissExport} />
        <Scrubber count={sentenceCount} />
        <div className="player-controls">
          <div className="player-side">
            <SpeedControl />
          </div>
          <div className="player-transport">
            <button type="button" className="icon-btn transport-btn" aria-label="Previous sentence" title="Previous sentence" onClick={() => player.prev()}>
              <PrevIcon size={22} />
            </button>
            <PlayButton />
            <button type="button" className="icon-btn transport-btn" aria-label="Next sentence" title="Next sentence" onClick={() => player.next()}>
              <NextIcon size={22} />
            </button>
          </div>
          <div className="player-side player-side--end">
            <VoiceControl />
            <MoreMenu exportState={exportState} onExport={onExport} />
          </div>
        </div>
      </div>
    </div>
  );
}
