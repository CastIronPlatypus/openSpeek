import { createElement, memo, useCallback, useMemo, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import type { Block, Sentence } from '../../types';
import type { HighlightHub } from './highlightHub';

interface ReaderBodyProps {
  blocks: Block[];
  sentences: Sentence[];
  hub: HighlightHub;
  onSeek: (index: number) => void;
}

/** The document text. Rendered once per document; player ticks reach only `SentenceSpan`s via the hub. */
export const ReaderBody = memo(function ReaderBody({ blocks, sentences, hub, onSeek }: ReaderBodyProps) {
  const byBlock = useMemo(() => {
    const groups: Sentence[][] = blocks.map(() => []);
    for (const s of sentences) groups[s.block]?.push(s);
    return groups;
  }, [blocks, sentences]);

  // One delegated handler instead of a closure per sentence.
  const onClick = useCallback(
    (e: MouseEvent) => {
      if (window.getSelection()?.toString()) return;
      const el = (e.target as Element).closest<HTMLElement>('[data-s]');
      if (el) onSeek(Number(el.dataset.s));
    },
    [onSeek],
  );

  return (
    <article className="reader-text" onClick={onClick}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} sentences={byBlock[i]} hub={hub} />
      ))}
    </article>
  );
});

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
