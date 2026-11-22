import { useApp } from '../appModel';
import { AlertIcon, CloseIcon } from '../common/icons';
import { usePlayerState } from '../reader/usePlayerState';
import type { ExportState } from '../reader/useAudioExport';

interface PlayerNoticeProps {
  exportState: ExportState;
  onCancelExport: () => void;
  onDismissExport: () => void;
}

/** Status line above the controls: model download, errors, end of document, audio export. */
export function PlayerNotice({ exportState, onCancelExport, onDismissExport }: PlayerNoticeProps) {
  return (
    <div className="player-notices">
      <PlaybackNotice />
      {exportState.phase === 'running' && (
        <div className="player-notice" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="player-notice-text">
            Saving audio… {exportState.done} of {exportState.total} sentences
          </span>
          <progress className="notice-progress" max={exportState.total} value={exportState.done} aria-label="Audio export" />
          <button type="button" className="btn btn--small" onClick={onCancelExport}>
            Cancel
          </button>
        </div>
      )}
      {exportState.phase === 'error' && (
        <div className="player-notice player-notice--error" role="alert">
          <AlertIcon size={18} />
          <span className="player-notice-text">Couldn’t save audio: {exportState.message}</span>
          <button type="button" className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={onDismissExport}>
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function PlaybackNotice() {
  const { player } = useApp().services;
  const status = usePlayerState((s) => s.status);
  const error = usePlayerState((s) => s.error);
  const fraction = usePlayerState((s) => s.modelProgress?.fraction ?? null);

  if (status === 'error') {
    return (
      <div className="player-notice player-notice--error" role="alert">
        <AlertIcon size={18} />
        <span className="player-notice-text">{error ?? 'Something went wrong while speaking.'}</span>
        <button type="button" className="btn btn--small" onClick={() => void player.play()}>
          Try again
        </button>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="player-notice" role="status">
        <span className="visually-hidden">Getting the voice ready</span>
        <span className="player-notice-text" aria-hidden="true">
          {fraction === null ? 'Getting the voice ready…' : `Downloading voice model… ${Math.round(fraction * 100)}%`}
        </span>
        {fraction !== null && (
          <span className="muted small hide-narrow" aria-hidden="true">
            One-time download, then it works offline
          </span>
        )}
      </div>
    );
  }
  if (status === 'ended') {
    return (
      <div className="player-notice" role="status">
        <span className="player-notice-text">You’ve reached the end.</span>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            player.seek(0);
            void player.play();
          }}
        >
          Listen again
        </button>
      </div>
    );
  }
  return null;
}
