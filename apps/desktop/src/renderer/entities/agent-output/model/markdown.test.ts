import { describe, expect, it } from 'vitest';
import { hasMarkdown, parseInline, parseMarkdown } from './markdown';
import { highlight, languageOf } from './highlight';

/** The audit's sample message (UXA Output): headings, a list, a diff fence and a link. */
const SAMPLE = [
  'The grid builds. One test fails: `JobGridTests.FiltersByDateRange` expects the end date to be *inclusive*.',
  '',
  '- `JobFilterState.To` is compared with < instead of <=',
  '- the old WinForms grid had the same bug (#71288)',
  '',
  '```diff',
  '- .Where(j => j.Due < filter.To)',
  '+ .Where(j => j.Due <= filter.To)',
  '```',
  '',
  'See [the cutover notes](https://example.invalid/notes) for the modal split.',
  '',
  '## Next',
  '1. Fix the comparison',
  '2. Re-run the grid tests',
  '   - including the bUnit ones',
].join('\n');

describe('parseMarkdown (AL-255)', () => {
  it('reads the audit sample into paragraphs, a list, a diff fence, a link, a heading and a nested numbered list', () => {
    const blocks = parseMarkdown(SAMPLE);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'code', 'paragraph', 'heading', 'list']);
    expect(blocks[0]).toMatchObject({ spans: [{ kind: 'text' }, { kind: 'code', text: 'JobGridTests.FiltersByDateRange' }, { kind: 'text' }, { kind: 'italic', text: 'inclusive' }, { kind: 'text', text: '.' }] });
    expect(blocks[1]).toMatchObject({ ordered: false, items: [{ spans: [{ kind: 'code', text: 'JobFilterState.To' }, { kind: 'text', text: ' is compared with < instead of <=' }] }, {}] });
    expect(blocks[2]).toEqual({ kind: 'code', language: 'diff', text: '- .Where(j => j.Due < filter.To)\n+ .Where(j => j.Due <= filter.To)', open: false });
    expect(blocks[3]).toMatchObject({ spans: [{ kind: 'text', text: 'See ' }, { kind: 'link', text: 'the cutover notes', href: 'https://example.invalid/notes' }, { kind: 'text' }] });
    expect(blocks[4]).toMatchObject({ level: 2, spans: [{ kind: 'text', text: 'Next' }] });
    expect(blocks[5]).toMatchObject({ ordered: true, start: 1, items: [{ children: [] }, { children: [{ kind: 'list', ordered: false, items: [{ spans: [{ text: 'including the bUnit ones' }] }] }] }] });
  });

  it('keeps an unterminated fence open to the end, for streaming text', () => {
    expect(parseMarkdown('Fixing it:\n```ts\nconst a = 1;')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Fixing it:' }] },
      { kind: 'code', language: 'ts', text: 'const a = 1;', open: true },
    ]);
  });

  it('reads quotes, rules and tables', () => {
    const blocks = parseMarkdown('> a note\n> continued\n\n---\n\n| Name | Lines |\n| --- | ---: |\n| a.cs | 12 |\n| b.cs | 3 |');
    expect(blocks[0]).toMatchObject({ kind: 'quote', blocks: [{ kind: 'paragraph', spans: [{ text: 'a note\ncontinued' }] }] });
    expect(blocks[1]).toEqual({ kind: 'rule' });
    expect(blocks[2]).toMatchObject({ kind: 'table', header: [[{ text: 'Name' }], [{ text: 'Lines' }]], rows: [[[{ text: 'a.cs' }], [{ text: '12' }]], [[{ text: 'b.cs' }], [{ text: '3' }]]] });
  });

  it('reads bold, bold with code inside, underscores and bare URLs', () => {
    expect(parseInline('Keep **frmJobAttachments** and __IWinFormsInvoker__ as is')).toEqual([
      { kind: 'text', text: 'Keep ' },
      { kind: 'bold', text: 'frmJobAttachments' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'IWinFormsInvoker' },
      { kind: 'text', text: ' as is' },
    ]);
    expect(parseInline('see https://dev.azure.com/x/_git/y now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://dev.azure.com/x/_git/y', href: 'https://dev.azure.com/x/_git/y' },
      { kind: 'text', text: ' now' },
    ]);
    // Underscores inside words are not emphasis.
    expect(parseInline('snake_case_name here')).toEqual([{ kind: 'text', text: 'snake_case_name here' }]);
    expect(hasMarkdown('plain words only')).toBe(false);
    expect(hasMarkdown('a `code` word')).toBe(true);
  });
});

describe('highlight (AL-255)', () => {
  it('maps fence tags to language families', () => {
    expect(languageOf('cs')).toBe('csharp');
    expect(languageOf('razor')).toBe('xml');
    expect(languageOf('ps1')).toBe('powershell');
    expect(languageOf('TSX')).toBe('typescript');
    expect(languageOf('')).toBe('plain');
    expect(languageOf('brainfuck')).toBe('plain');
  });

  it('tints keywords, strings, comments and numbers in C#', () => {
    const [line] = highlight('var x = "a\\"b"; // note 42', 'csharp');
    expect(line).toEqual([
      { kind: 'keyword', text: 'var' },
      { kind: 'plain', text: ' x = ' },
      { kind: 'string', text: '"a\\"b"' },
      { kind: 'plain', text: '; ' },
      { kind: 'comment', text: '// note 42' },
    ]);
    expect(highlight('return 3.5f;', 'csharp')[0]).toEqual([{ kind: 'keyword', text: 'return' }, { kind: 'plain', text: ' ' }, { kind: 'number', text: '3.5f' }, { kind: 'plain', text: ';' }]);
  });

  it('carries a block comment and a verbatim string across lines', () => {
    const lines = highlight('/* start\nmiddle */ int a;\nvar s = @"one\ntwo";', 'csharp');
    expect(lines[0]).toEqual([{ kind: 'comment', text: '/* start' }]);
    expect(lines[1]).toEqual([{ kind: 'comment', text: 'middle */' }, { kind: 'plain', text: ' ' }, { kind: 'keyword', text: 'int' }, { kind: 'plain', text: ' a;' }]);
    expect(lines[2]).toEqual([{ kind: 'keyword', text: 'var' }, { kind: 'plain', text: ' s = ' }, { kind: 'string', text: '@"one' }]);
    expect(lines[3]).toEqual([{ kind: 'string', text: 'two"' }, { kind: 'plain', text: ';' }]);
  });

  it("reads VB comments and keywords without case, PowerShell variables, XML tags and diff lines", () => {
    expect(highlight("Dim x As Integer ' count", 'vb')[0]).toEqual([
      { kind: 'keyword', text: 'Dim' },
      { kind: 'plain', text: ' x ' },
      { kind: 'keyword', text: 'As' },
      { kind: 'plain', text: ' ' },
      { kind: 'keyword', text: 'Integer' },
      { kind: 'plain', text: ' ' },
      { kind: 'comment', text: "' count" },
    ]);
    expect(highlight('$name = Get-Item "x"', 'powershell')[0]).toEqual([{ kind: 'keyword', text: '$name' }, { kind: 'plain', text: ' = Get-Item ' }, { kind: 'string', text: '"x"' }]);
    expect(highlight('<Grid Rows="2">text</Grid>', 'xml')[0]).toEqual([
      { kind: 'tag', text: '<Grid' },
      { kind: 'plain', text: ' Rows=' },
      { kind: 'string', text: '"2"' },
      { kind: 'tag', text: '>' },
      { kind: 'plain', text: 'text' },
      { kind: 'tag', text: '</Grid' },
      { kind: 'tag', text: '>' },
    ]);
    expect(highlight('@@ -1 +1 @@\n-old\n+new\n same', 'diff')).toEqual([[{ kind: 'meta', text: '@@ -1 +1 @@' }], [{ kind: 'removed', text: '-old' }], [{ kind: 'added', text: '+new' }], [{ kind: 'plain', text: ' same' }]]);
    expect(highlight('x', 'plain')).toEqual([[{ kind: 'plain', text: 'x' }]]);
  });
});
