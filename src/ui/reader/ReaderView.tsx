import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { nextSectionStart, outline, previousSectionStart, sectionAt } from '../../ingest/outline';
import type { Sentence, SourceKind, StoredDocument } from '../../types';
import { useApp, useSettings } from '../appModel';
import { AppHeader, SettingsButton, ThemeToggle } from '../common/AppHeader';
import { BackIcon, KeyboardIcon, LocateIcon } from '../common/icons';
import { Popover } from '../common/Popover';
import { PlayerBar } from '../player-bar/PlayerBar';
import { SectionButton } from '../player-bar/SectionButton';
import { RATE_STEP } from '../player-bar/SpeedControl';
import { openLibrary } from '../useHashRoute';
import { ContentsPanel } from './ContentsPanel';
import { createHighlightHub } from './highlightHub';
import { ReaderBody } from './ReaderBody';
import { useAudioExport } from './useAudioExport';
import { useAutoFollow } from './useAutoFollow';
import { useMediaMetadata } from './useMediaMetadata';
import { useProgressSaver } from './useProgressSaver';
import { SHORTCUTS, useReaderShortcuts } from './useReaderShortcuts';
import { useReaderDocument } from './useReaderDocument';
import { useContentsMode, useContentsOpen } from './useSections';
import { createSectionHub } from './sectionHub';
import '../styles/reader.css';

interface ReaderViewProps {
  id: string;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
}

export function ReaderView({ id, onOpenSettings, onOpenFeedback }: ReaderViewProps) {
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
        <Reader doc={state.doc} sentences={state.sentences} onOpenFeedback={onOpenFeedback} />
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

function Reader({ doc, sentences, onOpenFeedback }: { doc: StoredDocument; sentences: Sentence[]; onOpenFeedback: () => void }) {
  const model = useApp();
  const { player } = model.services;
  const [settings] = useSettings();
  const barRef = useRef<HTMLDivElement>(null);
  const sectionButtonRef = useRef<HTMLButtonElement>(null);
  const hub = useMemo(() => createHighlightHub(player), [player]);
  const sections = useMemo(() => outline(doc.blocks, sentences), [doc.blocks, sentences]);
  const sectionHub = useMemo(() => createSectionHub(player, sections), [player, sections]);
  const sectionStarts = useMemo(() => sections.map((s) => s.firstSentence), [sections]);
  const hasContents = sections.length >= 2;
  const contentsMode = useContentsMode();
  const [contentsOpen, setContentsOpen] = useContentsOpen(contentsMode, hasContents);
  const [focusContents, setFocusContents] = useState(false);
  const audioExport = useAudioExport(sentences, doc.title);
  const { offscreen, jumpToCurrent, scrollToSentence } = useAutoFollow(settings.autoScroll, barRef);
  const playFrom = useCallback((index: number, charOffset: number) => void player.playFrom(index, charOffset), [player]);

  const toggleContents = useCallback(() => {
    setFocusContents(true);
    setContentsOpen(!contentsOpen);
  }, [contentsOpen, setContentsOpen]);
  const closeContents = useCallback(
    (restoreFocus: boolean) => {
      setContentsOpen(false);
      if (restoreFocus) sectionButtonRef.current?.focus({ preventScroll: true });
    },
    [setContentsOpen],
  );
  // Like tapping a word: listen from there now. The docked panel stays open while reading.
  const selectSection = useCallback(
    (index: number) => {
      const first = sections[index].firstSentence;
      void player.playFrom(first);
      scrollToSentence(first);
      if (contentsMode !== 'docked') closeContents(false);
    },
    [sections, player, scrollToSentence, contentsMode, closeContents],
  );
  // Media convention: back to the start of this section, unless just past it.
  const goToSection = useCallback(
    (direction: -1 | 1) => {
      const { sentenceIndex, elapsed, rate } = player.getState();
      const current = sectionAt(sections, sentenceIndex);
      const intoSection = current >= 0 ? (elapsed - player.timeAt(sections[current].firstSentence)) / rate : 0;
      const target =
        direction < 0 ? previousSectionStart(sections, sentenceIndex, intoSection) : nextSectionStart(sections, sentenceIndex);
      if (target === null) return;
      player.seek(target);
      scrollToSentence(target);
    },
    [player, sections, scrollToSentence],
  );
  const prevSection = useCallback(() => goToSection(-1), [goToSection]);
  const nextSection = useCallback(() => goToSection(1), [goToSection]);

  useProgressSaver(doc.id);
  useReaderSourceKind(doc.source.kind);
  usePlayerBarHeight(barRef);
  useMediaMetadata(doc.title, sectionHub);
  useReaderShortcuts({
    toggle: () => player.toggle(),
    prev: () => player.prev(),
    next: () => player.next(),
    faster: () => model.setRate(model.settings.get().rate + RATE_STEP),
    slower: () => model.setRate(model.settings.get().rate - RATE_STEP),
    back: openLibrary,
    ...(hasContents && { prevSection, nextSection, contents: toggleContents }),
  });

  const docked = contentsOpen && contentsMode === 'docked';
  return (
    <>
      <main
        className={docked ? 'reader-main reader-main--beside-contents' : 'reader-main'}
        style={{ '--reader-font-size': `${settings.fontSize}px` } as CSSProperties}
      >
        {sentences.length === 0 ? (
          <p className="muted">This document has no readable text.</p>
        ) : (
          <ReaderBody blocks={doc.blocks} sentences={sentences} hub={hub} onPlayFrom={playFrom} />
        )}
      </main>
      {contentsOpen && (
        <ContentsPanel
          hub={sectionHub}
          mode={contentsMode}
          autoFocus={focusContents}
          onClose={closeContents}
          onSelect={selectSection}
          onPrev={prevSection}
          onNext={nextSection}
        />
      )}
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
        onFeedback={onOpenFeedback}
        marks={hasContents ? sectionStarts : undefined}
        section={
          hasContents && <SectionButton ref={sectionButtonRef} hub={sectionHub} expanded={contentsOpen} onClick={toggleContents} />
        }
      />
    </>
  );
}

/** Tells feedback which kind of document is open (only the kind: never its title, text or origin). */
function useReaderSourceKind(kind: SourceKind) {
  const { readerSourceKind } = useApp();
  useEffect(() => {
    readerSourceKind.set(kind);
    return () => readerSourceKind.set(null);
  }, [readerSourceKind, kind]);
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
