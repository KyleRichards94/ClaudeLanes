import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToBlocks, markdownToBlocks, safeHref } from './rich-text';

/** Every character the blocks carry, to check nothing of the markup survives. */
function allText(html: string): string {
  return htmlToBlocks(html)
    .flatMap((block) => block.spans.map((span) => span.text))
    .join('|');
}

describe('htmlToBlocks (AL-180)', () => {
  it('reads paragraphs, line breaks, bold, italic and code', () => {
    expect(htmlToBlocks('<div>Cut over <b>frmJobControl</b> to <i>Blazor</i>.<br>Keep <code>frmJobNotes</code>.</div><p>  Second   paragraph </p>')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: 'Cut over ' },
          { text: 'frmJobControl', bold: true },
          { text: ' to ' },
          { text: 'Blazor', italic: true },
          { text: '.\nKeep ' },
          { text: 'frmJobNotes', code: true },
          { text: '.' },
        ],
      },
      { kind: 'paragraph', spans: [{ text: 'Second paragraph' }] },
    ]);
  });

  it('reads headings and nested ordered and unordered lists', () => {
    const blocks = htmlToBlocks('<h2>Criteria</h2><ol><li>Grid loads</li><li>Filters <ul><li>by date</li></ul></li></ol>');
    expect(blocks).toEqual([
      { kind: 'heading', spans: [{ text: 'Criteria', bold: true }] },
      { kind: 'list-item', marker: '1.', depth: 1, spans: [{ text: 'Grid loads' }] },
      { kind: 'list-item', marker: '2.', depth: 1, spans: [{ text: 'Filters' }] },
      { kind: 'list-item', marker: '•', depth: 2, spans: [{ text: 'by date' }] },
    ]);
  });

  it('decodes entities once and keeps the result as text', () => {
    expect(allText('<p>a &amp;lt;b&amp;gt; &lt;script&gt; &#8594; &#x2192; &nbsp;x &bogus;</p>')).toBe('a &lt;b&gt; <script> → →  x &bogus;');
  });

  it('drops scripts, styles, frames and every attribute', () => {
    const hostile =
      '<p onclick="steal()">Hi<script>alert(1)</script><style>p{display:none}</style></p>' +
      '<img src=x onerror="alert(2)"><iframe src="https://evil.example"><p>inside</p></iframe>' +
      '<svg><script>alert(3)</script><text>svg text</text></svg><!-- secret --><p>bye</p>';
    const text = allText(hostile);
    expect(text).toBe('Hi|[Image]|bye');
    expect(text).not.toMatch(/alert|onerror|onclick|secret|evil|inside|svg text|</);
  });

  it('keeps only http(s) links', () => {
    const blocks = htmlToBlocks('<p><a href="https://dev.azure.com/contoso/_workitems/edit/1">spec</a> <a href="javascript:alert(1)">click</a> <a href="/relative">rel</a></p>');
    expect(blocks[0]?.spans).toEqual([
      { text: 'spec', href: 'https://dev.azure.com/contoso/_workitems/edit/1' },
      { text: ' click rel' },
    ]);
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref(' HTTPS://Example.com/a ')).toBe('https://example.com/a');
  });

  it('keeps preformatted text as written and names images by their alt text', () => {
    expect(htmlToBlocks('<pre>if (x)\n    y();</pre><p><img alt="Grid mock-up" src="a.png"></p>')).toEqual([
      { kind: 'code', spans: [{ text: 'if (x)\n    y();', code: true }] },
      { kind: 'paragraph', spans: [{ text: '[Image: Grid mock-up]' }] },
    ]);
  });

  it('survives broken markup and plain text', () => {
    expect(allText('<p>unclosed <b>bold')).toBe('unclosed |bold');
    expect(allText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
    expect(htmlToBlocks('')).toEqual([]);
    expect(htmlToBlocks('<p> </p><div><br></div>')).toEqual([]);
  });

  it('decodes numeric entities but not control characters', () => {
    expect(decodeEntities('&#0;&#7;&#65;&#x1F600;')).toBe('A😀');
  });
});

describe('markdownToBlocks', () => {
  it('splits paragraphs, list items and headings and keeps markup characters as typed', () => {
    expect(markdownToBlocks('# Plan\nStep **one**\nstill one\n\n- grid\n2. filter\n<b>x</b>')).toEqual([
      { kind: 'heading', spans: [{ text: 'Plan', bold: true }] },
      { kind: 'paragraph', spans: [{ text: 'Step **one**\nstill one' }] },
      { kind: 'list-item', marker: '•', depth: 1, spans: [{ text: 'grid' }] },
      { kind: 'list-item', marker: '2.', depth: 1, spans: [{ text: 'filter' }] },
      { kind: 'paragraph', spans: [{ text: '<b>x</b>' }] },
    ]);
  });
});
