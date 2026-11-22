import { describe, expect, it } from 'vitest';
import { cleanText, importText, truncateTitle } from './text';

describe('importText', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    const draft = importText('My Title\n\nThis is a paragraph that was\nhard wrapped across lines.\n\n\nSecond paragraph.');
    expect(draft.title).toBe('My Title');
    expect(draft.source).toEqual({ kind: 'text' });
    expect(draft.blocks).toEqual([
      { kind: 'paragraph', text: 'My Title' },
      { kind: 'paragraph', text: 'This is a paragraph that was hard wrapped across lines.' },
      { kind: 'paragraph', text: 'Second paragraph.' },
    ]);
  });

  it('keeps list items and short title-like lines separate', () => {
    const draft = importText(
      'Shopping list\n- eggs and a long description of what kind of eggs\n- milk\n1. first\n2) second\n\n' +
        'Chapter One\nIt was a dark and stormy night, and the rain fell in torrents except at\noccasional intervals.',
    );
    expect(draft.blocks.map((b) => b.text)).toEqual([
      'Shopping list',
      '- eggs and a long description of what kind of eggs',
      '- milk',
      '1. first',
      '2) second',
      'Chapter One',
      'It was a dark and stormy night, and the rain fell in torrents except at occasional intervals.',
    ]);
  });

  it('normalises whitespace and strips invisible characters', () => {
    const draft = importText('Hy\u00ADphen\u200Bated\u00A0text\r\nwith\tCRLF.', 'Custom');
    expect(draft.title).toBe('Custom');
    expect(draft.blocks).toEqual([{ kind: 'paragraph', text: 'Hyphenated text with CRLF.' }]);
  });

  it('truncates long first lines for the title', () => {
    const line = 'word '.repeat(40).trim();
    const title = importText(line).title;
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('word…')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(() => importText('  \n\n ** \n')).toThrow(/no readable text/i);
  });
});

describe('helpers', () => {
  it('cleanText collapses whitespace', () => {
    expect(cleanText('  a \n\t b\u00A0 c  ')).toBe('a b c');
  });
  it('truncateTitle leaves short titles alone', () => {
    expect(truncateTitle('Short')).toBe('Short');
  });
});
