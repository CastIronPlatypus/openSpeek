import { describe, expect, it } from 'vitest';
import { importFile } from './file';
import { markdownToBlocks, stripInline } from './markdown';

describe('markdownToBlocks', () => {
  it('parses headings, paragraphs, lists and quotes, dropping code', () => {
    const md = [
      '# The **Title** #',
      '',
      'Some *emphasis*, __bold__, `code`, a [link](https://x.y "t") and ![img](a.png) here.',
      'Continued line with <b>html</b> and snake_case_name.',
      '',
      '```js',
      'const secret = 1;',
      '```',
      '',
      '> A quoted',
      '> thought.',
      '',
      '- item one',
      '* item two',
      '1. item three',
      '',
      'Setext Heading',
      '--------------',
      '',
      '---',
      '[ref]: https://example.com',
      '| a | b |',
      '|---|---|',
      '## Sub ~~heading~~',
    ].join('\n');
    expect(markdownToBlocks(md)).toEqual([
      { kind: 'heading', level: 1, text: 'The Title' },
      {
        kind: 'paragraph',
        text: 'Some emphasis, bold, code, a link and here. Continued line with html and snake_case_name.',
      },
      { kind: 'paragraph', text: 'A quoted thought.' },
      { kind: 'paragraph', text: 'item one' },
      { kind: 'paragraph', text: 'item two' },
      { kind: 'paragraph', text: 'item three' },
      { kind: 'heading', level: 2, text: 'Setext Heading' },
      { kind: 'paragraph', text: 'a b' },
      { kind: 'heading', level: 2, text: 'Sub heading' },
    ]);
  });

  it('strips escapes and autolinks', () => {
    expect(stripInline('2 \\* 3 <https://a.b> [x][1]')).toBe('2 * 3 https://a.b x');
  });

  it('imports .md files with the first heading as title', async () => {
    const draft = await importFile(new File(['Intro text.\n\n# Real Title\n\nBody.'], 'notes.md'));
    expect(draft.title).toBe('Real Title');
    expect(draft.source).toEqual({ kind: 'markdown', fileName: 'notes.md' });
    expect(draft.blocks).toHaveLength(3);
  });

  it('falls back to the file name and rejects code-only files', async () => {
    expect((await importFile(new File(['Just text.'], 'my-notes.markdown'))).title).toBe('my-notes');
    await expect(importFile(new File(['```\ncode\n```'], 'c.md'))).rejects.toThrow(/no readable text/i);
  });
});
