import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { filterSections } from '../../ingest/outline';
import type { Section } from '../../types';
import { CloseIcon, NextSectionIcon, PrevSectionIcon, SearchIcon } from '../common/icons';
import { useSwipeToClose } from '../common/useSwipeToClose';
import type { SectionHub } from './sectionHub';
import {
  sectionTitle,
  UNTITLED_SECTION,
  useCurrentSection,
  useSectionDurations,
  useSectionProgress,
  useSectionStatus,
  type ContentsMode,
} from './useSections';

/** Above this many sections the panel offers a filter box. */
const FILTER_MIN_SECTIONS = 12;

interface ContentsPanelProps {
  hub: SectionHub;
  mode: ContentsMode;
  /** Move focus into the panel when it appears (an explicit open, not one restored on load). */
  autoFocus: boolean;
  onClose: (restoreFocus: boolean) => void;
  onSelect: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll position that centres `row` in `list`. */
function centredTop(list: HTMLElement, row: HTMLElement): number {
  return row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
}

function isVisibleIn(list: HTMLElement, row: HTMLElement): boolean {
  const top = row.offsetTop - list.scrollTop;
  return top >= 0 && top + row.offsetHeight <= list.clientHeight;
}

/**
 * The table of contents: a bottom sheet on phones, a drawer on mid-size screens, a panel docked
 * beside the text on wide ones. Rows subscribe to their own status through the section hub, so
 * playback crossing a heading re-renders just the two rows involved.
 */
export function ContentsPanel({ hub, mode, autoFocus, onClose, onSelect, onPrev, onNext }: ContentsPanelProps) {
  const { sections } = hub;
  const overlay = mode !== 'docked';
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterSections(sections, query, UNTITLED_SECTION), [sections, query]);
  const durations = useSectionDurations(sections);
  const swipe = useSwipeToClose(panelRef, () => onClose(true), mode === 'sheet');

  // Before the first paint: centre the current section, with no visible scrolling.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-section="${hub.current()}"]`);
    if (list && row) list.scrollTop = centredTop(list, row);
    if (autoFocus) (row ?? panelRef.current)?.focus({ preventScroll: true });
  }, []); // Only when the panel opens.

  // Keep following playback while the reader has not scrolled the list away from it.
  useEffect(() => {
    let previous = hub.current();
    return hub.subscribeCurrent(() => {
      const list = listRef.current;
      const next = hub.current();
      const oldRow = list?.querySelector<HTMLElement>(`[data-section="${previous}"]`);
      const newRow = list?.querySelector<HTMLElement>(`[data-section="${next}"]`);
      previous = next;
      if (!list || !newRow || isVisibleIn(list, newRow)) return;
      if (oldRow && !isVisibleIn(list, oldRow)) return;
      list.scrollTo({ top: centredTop(list, newRow), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }, [hub]);

  // Overlays close on Esc from anywhere; the docked panel only when focus is inside it (below).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose(true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [overlay, onClose]);

  const panelClass = mode === 'sheet' ? 'popover-panel contents-panel' : 'contents-panel';
  return (
    <>
      {overlay && (
        <div className={mode === 'sheet' ? 'popover-backdrop' : 'contents-backdrop'} aria-hidden="true" onClick={() => onClose(false)} />
      )}
      <aside
        ref={panelRef}
        className={panelClass}
        data-mode={mode}
        role={overlay ? 'dialog' : 'region'}
        aria-modal={overlay || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (!overlay && e.key === 'Escape') {
            e.preventDefault();
            onClose(true);
          }
        }}
        onBlur={(e) => {
          // Like the popovers: an overlay closes when focus moves elsewhere.
          if (overlay && e.relatedTarget && !panelRef.current?.contains(e.relatedTarget as Node)) onClose(false);
        }}
      >
        <div className="popover-head contents-head" {...swipe}>
          <h2 id={titleId} className="popover-title">
            Contents
          </h2>
          <div className="contents-head-actions">
            <ContentsNav hub={hub} onPrev={onPrev} onNext={onNext} />
            <button type="button" className="icon-btn" aria-label="Close contents" title="Close (Esc)" onClick={() => onClose(true)}>
              <CloseIcon size={20} />
            </button>
          </div>
        </div>
        {sections.length > FILTER_MIN_SECTIONS && (
          <div className="contents-filter">
            <label className="search-field">
              <SearchIcon size={18} />
              <span className="visually-hidden">Filter sections</span>
              <input
                type="search"
                placeholder="Filter sections"
                autoComplete="off"
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        )}
        <ol className="contents-list" ref={listRef} aria-labelledby={titleId}>
          {visible.map((i) => (
            <SectionRow key={i} hub={hub} index={i} section={sections[i]} duration={durations[i]} onSelect={onSelect} />
          ))}
        </ol>
        {visible.length === 0 && <p className="contents-empty muted">No section titles contain “{query.trim()}”.</p>}
      </aside>
    </>
  );
}

function ContentsNav({ hub, onPrev, onNext }: { hub: SectionHub; onPrev: () => void; onNext: () => void }) {
  const current = useCurrentSection(hub);
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Previous section" title="Previous section (Shift+←)" onClick={onPrev}>
        <PrevSectionIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Next section"
        title="Next section (Shift+→)"
        disabled={current >= hub.sections.length - 1}
        onClick={onNext}
      >
        <NextSectionIcon />
      </button>
    </>
  );
}

interface SectionRowProps {
  hub: SectionHub;
  index: number;
  section: Section;
  duration: string;
  onSelect: (index: number) => void;
}

const SectionRow = memo(function SectionRow({ hub, index, section, duration, onSelect }: SectionRowProps) {
  const status = useSectionStatus(hub, index);
  return (
    <li className="contents-item" data-status={status} style={{ '--depth': section.depth } as CSSProperties}>
      <button
        type="button"
        className="contents-row"
        data-section={index}
        aria-current={status === 'current' ? 'true' : undefined}
        onClick={() => onSelect(index)}
      >
        <span className={section.title ? 'contents-row-title' : 'contents-row-title contents-row-title--untitled'}>
          {sectionTitle(section)}
        </span>
        <span className="contents-row-time">
          {duration}
          {status === 'done' && <span className="visually-hidden">, finished</span>}
        </span>
        {status === 'current' && <SectionProgress section={section} />}
      </button>
    </li>
  );
});

/** The current row's progress bar; the only part of the list that follows sentence ticks. */
function SectionProgress({ section }: { section: Section }) {
  const percent = useSectionProgress(section);
  return <span className="contents-row-progress" style={{ '--progress': `${percent}%` } as CSSProperties} aria-hidden="true" />;
}
