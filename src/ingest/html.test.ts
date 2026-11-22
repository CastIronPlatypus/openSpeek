import { describe, expect, it, vi } from 'vitest';
import { importFile } from './file';
import { htmlToBlocks, importHtmlFragment } from './html';

const body = (html: string) => new DOMParser().parseFromString(html, 'text/html').body;

describe('htmlToBlocks', () => {
  it('emits one block per block element without duplicating nested text', () => {
    const blocks = htmlToBlocks(
      body(`
        <h1>Title <em>here</em></h1>
        <div>Loose text in a div <span>with inline</span>
          <p>Nested <a href="#">paragraph</a>.</p>
          tail text
        </div>
        <ul><li>One</li><li>Two <ul><li>Two point one</li></ul></li></ul>
        <blockquote><p>Quote.</p></blockquote>
        <table><tr><td>Cell A</td><td>Cell B</td></tr></table>
        <figure><img src="x.png"><figcaption>Caption</figcaption></figure>
        <p>Line<br>break</p>
        <pre>code   block</pre>
        <h3>Small heading</h3>
      `),
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title here' },
      { kind: 'paragraph', text: 'Loose text in a div with inline' },
      { kind: 'paragraph', text: 'Nested paragraph.' },
      { kind: 'paragraph', text: 'tail text' },
      { kind: 'paragraph', text: 'One' },
      { kind: 'paragraph', text: 'Two' },
      { kind: 'paragraph', text: 'Two point one' },
      { kind: 'paragraph', text: 'Quote.' },
      { kind: 'paragraph', text: 'Cell A' },
      { kind: 'paragraph', text: 'Cell B' },
      { kind: 'paragraph', text: 'Caption' },
      { kind: 'paragraph', text: 'Line break' },
      { kind: 'paragraph', text: 'code block' },
      { kind: 'heading', level: 3, text: 'Small heading' },
    ]);
  });

  it('skips non-content and hidden elements', () => {
    const blocks = htmlToBlocks(
      body(`
        <nav>Menu</nav><script>var x = 1;</script><style>p{}</style>
        <p>Keep me.</p>
        <aside>Ad</aside><footer>Footer</footer><form>Search</form><noscript>JS</noscript>
        <p hidden>Hidden</p><p style="display: none">None</p><div aria-hidden="true">Aria</div>
        <p>   </p>
      `),
    );
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'Keep me.' }]);
  });

  it('imports an HTML file through Readability', async () => {
    const paragraphs = Array.from(
      { length: 6 },
      (_, i) => `<p>This is paragraph ${i + 1} of the article, with enough words in it to look like real content to Readability, which scores text density.</p>`,
    ).join('');
    const html = `<html><head><title>Page Title</title></head><body>
      <nav><a href="/">Home</a> <a href="/about">About</a></nav>
      <article><h1>Article Headline</h1>${paragraphs}</article>
      <footer>Copyright</footer></body></html>`;
    const draft = await importFile(new File([html], 'page.html', { type: 'text/html' }));
    expect(draft.source).toEqual({ kind: 'html', fileName: 'page.html' });
    expect(draft.blocks[0]).toEqual({ kind: 'heading', level: 1, text: draft.title });
    const texts = draft.blocks.map((b) => b.text);
    expect(texts).toContain(
      'This is paragraph 1 of the article, with enough words in it to look like real content to Readability, which scores text density.',
    );
    expect(texts.join(' ')).not.toMatch(/Copyright|About/);
  });
});

describe('importHtmlFragment', () => {
  it('keeps headings and paragraphs of pasted rich text and titles it by the first heading', () => {
    const html =
      '<meta charset="utf-8"><!--StartFragment--><p>Intro line.</p><h2>The <b>Heading</b></h2>' +
      '<p>First paragraph.</p><ul><li>An item</li></ul><!--EndFragment-->';
    const draft = importHtmlFragment(html, 'Intro line.\nThe Heading\nFirst paragraph.\nAn item');
    expect(draft).toEqual({
      title: 'The Heading',
      source: { kind: 'text' },
      blocks: [
        { kind: 'paragraph', text: 'Intro line.' },
        { kind: 'heading', level: 2, text: 'The Heading' },
        { kind: 'paragraph', text: 'First paragraph.' },
        { kind: 'paragraph', text: 'An item' },
      ],
    });
  });

  it('does not run Readability: short fragments and their first block survive', () => {
    const draft = importHtmlFragment('<div><span>Just one short sentence.</span></div>');
    expect(draft.title).toBe('Just one short sentence.');
    expect(draft.blocks).toEqual([{ kind: 'paragraph', text: 'Just one short sentence.' }]);
  });

  it('only parses: scripts, styles and handlers never run or reach the text', () => {
    const run = vi.fn();
    (globalThis as Record<string, unknown>).__pasted = run;
    const draft = importHtmlFragment(
      '<style>p{color:red}</style><script>__pasted()</script><img src="x" onerror="__pasted()"><p>Safe text.</p>',
    );
    expect(draft.blocks).toEqual([{ kind: 'paragraph', text: 'Safe text.' }]);
    expect(run).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('Safe text');
  });

  it('falls back to the plain text when the HTML has nothing readable or flattens its paragraphs', () => {
    expect(importHtmlFragment('<img src="a.png">', 'Plain words.').blocks).toEqual([
      { kind: 'paragraph', text: 'Plain words.' },
    ]);
    const flattened = importHtmlFragment('<span>One para.<br><br>Two para.</span>', 'One para.\n\nTwo para.');
    expect(flattened.blocks).toHaveLength(2);
    expect(flattened.title).toBe('One para.');
  });

  it('titles by the first line when there is no heading, and rejects empty fragments', () => {
    const draft = importHtmlFragment('<p>Opening words here.</p><p>More.</p>', 'Opening words here.\n\nMore.');
    expect(draft.title).toBe('Opening words here.');
    expect(() => importHtmlFragment('<p> </p>')).toThrow('There is no readable text to import.');
  });
});
