import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import type { Sentence, StoredDocument } from '../../types';
import { useApp, useSettings } from '../appModel';
import { AppHeader, SettingsButton, ThemeToggle } from '../common/AppHeader';
import { BackIcon, KeyboardIcon, LocateIcon } from '../common/icons';
import { Popover } from '../common/Popover';
import { PlayerBar } from '../player-bar/PlayerBar';
import { RATE_STEP } from '../player-bar/SpeedControl';
import { openLibrary } from '../useHashRoute';
import { createHighlightHub } from './highlightHub';
import { ReaderBody } from './ReaderBody';
import { useAudioExport } from './useAudioExport';
import { useAutoFollow } from './useAutoFollow';
import { useProgressSaver } from './useProgressSaver';
import { SHORTCUTS, useReaderShortcuts } from './useReaderShortcuts';
import { useReaderDocument } from './useReaderDocument';
import '../styles/reader.css';

interface ReaderViewProps {
  id: string;
  onOpenSettings: () => void;
}

export function ReaderView({ id, onOpenSettings }: ReaderViewProps) {
  const state = useReaderDocument(id);
  const title = state.status === 'ready' ? state.doc.title : '';

  return (
    <div className="page reader">
      <AppHeader
        start={
          <>
            <button type="button" className="icon-btn" aria-label="Back to library" title="Back to library (Esc)" onClick={openLibrary}>
              <BackIcon />
            </button>
            <h1 className="reader-title" title={title}>
              {title}
            </h1>
          </>
        }
        end={
          <>
            <ShortcutsHelp />
            <ThemeToggle />
            <SettingsButton onClick={onOpenSettings} />
          </>
        }
      />
      {state.status === 'ready' ? (
        <Reader doc={state.doc} sentences={state.sentences} />
      ) : (
        <main className="reader-message">
          {state.status === 'loading' && <span className="spinner" aria-label="Loading document" />}
          {state.status === 'missing' && <ReaderProblem text="This document isn’t in your library any more." />}
          {state.status === 'error' && <ReaderProblem text={`Couldn’t open this document: ${state.message}`} />}
        </main>
      )}
    </div>
  );
}

function ReaderProblem({ text }: { text: string }) {
  return (
    <div role="alert">
      <p>{text}</p>
      <button type="button" className="btn btn--primary" onClick={openLibrary}>
        Back to library
      </button>
    </div>
  );
}

function Reader({ doc, sentences }: { doc: StoredDocument; sentences: Sentence[] }) {
  const model = useApp();
  const { player } = model.services;
  const [settings] = useSettings();
  const barRef = useRef<HTMLDivElement>(null);
  const hub = useMemo(() => createHighlightHub(player), [player]);
  const audioExport = useAudioExport(sentences, doc.title);
  const { offscreen, jumpToCurrent } = useAutoFollow(settings.autoScroll, barRef);
  const playFrom = useCallback((index: number, charOffset: number) => void player.playFrom(index, charOffset), [player]);

  useProgressSaver(doc.id);
  usePlayerBarHeight(barRef);
  useReaderShortcuts({
    toggle: () => player.toggle(),
    prev: () => player.prev(),
    next: () => player.next(),
    faster: () => model.setRate(model.settings.get().rate + RATE_STEP),
    slower: () => model.setRate(model.settings.get().rate - RATE_STEP),
    back: openLibrary,
  });

  return (
    <>
      <main className="reader-main" style={{ '--reader-font-size': `${settings.fontSize}px` } as CSSProperties}>
        {sentences.length === 0 ? (
          <p className="muted">This document has no readable text.</p>
        ) : (
          <ReaderBody blocks={doc.blocks} sentences={sentences} hub={hub} onPlayFrom={playFrom} />
        )}
      </main>
      {offscreen && (
        <button type="button" className="follow-pill" onClick={jumpToCurrent}>
          <LocateIcon size={18} />
          Back to current sentence
        </button>
      )}
      <PlayerBar
        ref={barRef}
        sentenceCount={sentences.length}
        exportState={audioExport.state}
        onExport={audioExport.start}
        onCancelExport={audioExport.cancel}
        onDismissExport={audioExport.dismiss}
      />
    </>
  );
}

/** Publishes the bar's height as `--player-bar-h` so floating UI (pill, toasts) can sit above it. */
function usePlayerBarHeight(barRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const style = document.documentElement.style;
    const observer = new ResizeObserver(() => style.setProperty('--player-bar-h', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      style.removeProperty('--player-bar-h');
    };
  }, [barRef]);
}

function ShortcutsHelp() {
  return (
    <div className="hide-touch">
      <Popover label="Keyboard shortcuts" buttonContent={<KeyboardIcon />} title="Keyboard shortcuts" placement="bottom" align="end">
        {() => (
          <dl className="shortcuts">
            {SHORTCUTS.map((s) => (
              <div key={s.keys.join()} className="shortcut">
                <dt>
                  {s.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        )}
      </Popover>
    </div>
  );
}
