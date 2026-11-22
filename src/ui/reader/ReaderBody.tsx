import {
  createElement,
  memo,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { Block, Sentence } from '../../types';
import type { HighlightHub } from './highlightHub';

interface ReaderBodyProps {
  blocks: Block[];
  sentences: Sentence[];
  hub: HighlightHub;
  /** A tap on the text: play from that sentence, at `charOffset` into its text. */
  onPlayFrom: (index: number, charOffset: number) => void;
}

/** A press that moved further than this (px) was a drag or a scroll, not a tap. */
const TAP_SLOP = 10;
/** A press held longer than this (ms) was a long-press (e.g. to select), not a tap. */
const LONG_PRESS_MS = 500;

/** The document text. Rendered once per document; player ticks reach only `SentenceSpan`s via the hub. */
export const ReaderBody = memo(function ReaderBody({ blocks, sentences, hub, onPlayFrom }: ReaderBodyProps) {
  const byBlock = useMemo(() => {
    const groups: Sentence[][] = blocks.map(() => []);
    for (const s of sentences) groups[s.block]?.push(s);
    return groups;
  }, [blocks, sentences]);
  const press = useRef<{ x: number; y: number; time: number } | null>(null);

  const onPointerDown = useCallback((e: PointerEvent) => {
    press.current = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY, time: e.timeStamp } : null;
  }, []);

  // One delegated handler instead of a closure per sentence.
  const onClick = useCallback(
    (e: MouseEvent) => {
      const down = press.current;
      press.current = null;
      if (!down || !isTap(down, e)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const el = (e.target as Element).closest<HTMLElement>('[data-s]');
      if (el) onPlayFrom(Number(el.dataset.s), offsetAtPoint(el, e.clientX, e.clientY) ?? 0);
    },
    [onPlayFrom],
  );

  return (
    <article className="reader-text" onPointerDown={onPointerDown} onClick={onClick}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} sentences={byBlock[i]} hub={hub} />
      ))}
    </article>
  );
});

function isTap(down: { x: number; y: number; time: number }, up: MouseEvent): boolean {
  return (
    Math.hypot(up.clientX - down.x, up.clientY - down.y) <= TAP_SLOP && up.timeStamp - down.time <= LONG_PRESS_MS
  );
}

/** The text position under a point, from whichever API the browser has. */
function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  if ('caretPositionFromPoint' in document && typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if ('caretRangeFromPoint' in document && typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

/**
 * Offset into the sentence `el` of the character under a point, counted across all of its
 * text (the current sentence is split into several spans), or `null` when unknown.
 */
function offsetAtPoint(el: HTMLElement, x: number, y: number): number | null {
  const caret = caretAtPoint(x, y);
  if (!caret || !el.contains(caret.node)) return null;
  let { offset } = caret;
  // The caret lands between characters: on the right half of a character it comes after it.
  if (caret.node.nodeType === Node.TEXT_NODE && offset > 0) {
    const char = document.createRange();
    char.setStart(caret.node, offset - 1);
    char.setEnd(caret.node, offset);
    const hit = Array.from(char.getClientRects()).some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    if (hit) offset--;
  }
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(caret.node, offset);
  return before.toString().length;
}

const BlockView = memo(function BlockView({ block, sentences, hub }: { block: Block; sentences: Sentence[]; hub: HighlightHub }) {
  const children: ReactNode[] = [];
  let cursor = 0;
  for (const s of sentences) {
    if (s.start > cursor) children.push(block.text.slice(cursor, s.start));
    children.push(<SentenceSpan key={s.index} sentence={s} hub={hub} />);
    cursor = s.end;
  }
  if (cursor < block.text.length) children.push(block.text.slice(cursor));

  if (block.kind === 'heading') {
    const level = Math.min(6, Math.max(1, block.level ?? 2));
    // The page's h1 is the document title, so document headings start one level down.
    return createElement(`h${Math.min(6, level + 1)}`, { className: `reader-heading reader-h${level}` }, children);
  }
  return <p>{children}</p>;
});

const SentenceSpan = memo(function SentenceSpan({ sentence, hub }: { sentence: Sentence; hub: HighlightHub }) {
  const { index, text } = sentence;
  const subscribe = useCallback((listener: () => void) => hub.subscribe(index, listener), [hub, index]);
  const word = useSyncExternalStore(subscribe, () => hub.getSnapshot(index));

  if (!word) {
    return (
      <span className="s" data-s={index}>
        {text}
      </span>
    );
  }
  const hasWord = word.start >= 0 && word.end > word.start && word.end <= text.length;
  return (
    <span className="s s--current" data-s={index} aria-current="true">
      {hasWord ? (
        <>
          {text.slice(0, word.start)}
          <span className="w">{text.slice(word.start, word.end)}</span>
          {text.slice(word.end)}
        </>
      ) : (
        text
      )}
    </span>
  );
});
