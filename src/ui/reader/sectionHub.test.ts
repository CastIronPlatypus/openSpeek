import { describe, expect, it, vi } from 'vitest';
import { outline } from '../../ingest/outline';
import { segment } from '../../ingest/segment';
import type { Block, Player, PlayerState } from '../../types';
import { createSectionHub } from './sectionHub';

function fakePlayer() {
  let state = { sentenceIndex: 0 } as PlayerState;
  const listeners = new Set<() => void>();
  const player = {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as Player;
  const move = (sentenceIndex: number, word: PlayerState['word'] = null) => {
    state = { ...state, sentenceIndex, word };
    listeners.forEach((l) => l());
  };
  return { player, move, listeners };
}

const blocks: Block[] = [];
for (let c = 0; c < 6; c++) blocks.push({ kind: 'heading', level: 1, text: `Chapter ${c}` }, { kind: 'paragraph', text: 'One here. Two here.' });
// Each section has 3 sentences: heading + 2; section k starts at sentence 3k.
const sections = outline(blocks, segment(blocks));

describe('createSectionHub', () => {
  it('notifies only the rows whose status changes', () => {
    const { player, move } = fakePlayer();
    const hub = createSectionHub(player, sections);
    const calls = sections.map(() => vi.fn());
    const unsubs = calls.map((fn, i) => hub.subscribeRow(i, fn));
    const onCurrent = vi.fn();
    hub.subscribeCurrent(onCurrent);
    expect(hub.current()).toBe(0);
    expect(sections.map((_, i) => hub.status(i))).toEqual(['current', 'todo', 'todo', 'todo', 'todo', 'todo']);

    // Word and sentence ticks inside a section notify nobody.
    move(1, { start: 0, end: 3 });
    move(2);
    expect(calls.every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(onCurrent).not.toHaveBeenCalled();

    // Crossing a heading: only the two rows involved.
    move(3);
    expect(calls.map((fn) => fn.mock.calls.length)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(hub.status(0)).toBe('done');
    expect(hub.status(1)).toBe('current');
    expect(onCurrent).toHaveBeenCalledTimes(1);

    // A jump: the rows in between change too.
    move(15);
    expect(calls.map((fn) => fn.mock.calls.length)).toEqual([1, 2, 1, 1, 1, 1]);
    expect(sections.map((_, i) => hub.status(i))).toEqual(['done', 'done', 'done', 'done', 'done', 'current']);
    unsubs.forEach((u) => u());
  });

  it('subscribes to the player only while something listens', () => {
    const { player, move, listeners } = fakePlayer();
    const hub = createSectionHub(player, sections);
    move(7);
    expect(hub.current()).toBe(2);
    const off = hub.subscribeCurrent(() => {});
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
    move(10);
    expect(hub.current()).toBe(3);
  });
});
