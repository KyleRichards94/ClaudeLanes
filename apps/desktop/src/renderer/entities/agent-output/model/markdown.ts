/**
 * A small Markdown reader for the agent's prose (AL-255): the subset Claude writes in its replies.
 * Headings, paragraphs, bullet and numbered lists (one level of nesting), fenced code with its
 * language, block quotes, tables, rules; inline bold, italic, code and links. Nothing is turned into
 * HTML: the Output tab draws blocks and spans as React Native elements.
 *
 * Streaming text is read the same way: an unterminated fence is a code block to the end.
 */

export type InlineSpan =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'italic'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export interface ListItem {
  readonly spans: readonly InlineSpan[];
  /** A nested list under this item. */
  readonly children: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly spans: readonly InlineSpan[] }
  | { readonly kind: 'paragraph'; readonly spans: readonly InlineSpan[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly ListItem[] }
  | { readonly kind: 'code'; readonly language: string | null; readonly text: string; readonly open: boolean }
  | { readonly kind: 'quote'; readonly blocks: readonly MarkdownBlock[] }
  | { readonly kind: 'table'; readonly header: readonly (readonly InlineSpan[])[]; readonly rows: readonly (readonly InlineSpan[])[][] }
  | { readonly kind: 'rule' };

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** The blocks of a Markdown text. Linear in its length. */
export function parseMarkdown(text: string): MarkdownBlock[] {
  return parseLines(text.replace(/\r\n?/g, '\n').split('\n'));
}

function parseLines(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[2]!;
      const language = fence[3] || null;
      const body: string[] = [];
      let closed = false;
      index += 1;
      for (; index < lines.length; index++) {
        const candidate = lines[index]!;
        if (candidate.trim().startsWith(marker[0]!.repeat(3)) && candidate.trim().replace(/[`~]/g, '') === '') {
          closed = true;
          break;
        }
        body.push(candidate);
      }
      blocks.push({ kind: 'code', language, text: body.join('\n'), open: !closed });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (RULE.test(line) && paragraph.length === 0) {
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, spans: parseInline(heading[2]!) });
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      for (; index < lines.length && QUOTE.test(lines[index]!); index++) quoted.push(QUOTE.exec(lines[index]!)![1]!);
      index -= 1;
      blocks.push({ kind: 'quote', blocks: parseLines(quoted) });
      continue;
    }

    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]!)) {
      flushParagraph();
      const header = splitCells(line).map(parseInline);
      const rows: InlineSpan[][][] = [];
      index += 2;
      for (; index < lines.length && TABLE_ROW.test(lines[index]!); index++) rows.push(splitCells(lines[index]!).map(parseInline));
      index -= 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const list = readList(lines, index);
      blocks.push(list.block);
      index = list.end;
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Reads a list starting at `start`; nested items are indented at least two spaces further. */
function readList(lines: readonly string[], start: number): { block: MarkdownBlock; end: number } {
  const first = (BULLET.exec(lines[start]!) ?? NUMBERED.exec(lines[start]!))!;
  const indent = first[1]!.length;
  const ordered = NUMBERED.test(lines[start]!);
  const startNumber = ordered ? Number(first[2]) : 1;
  const items: ListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index]!;
    const match = (ordered ? NUMBERED : BULLET).exec(line) ?? (ordered ? BULLET : NUMBERED).exec(line);
    if (!match || match[1]!.length !== indent) break;
    const itemText = [ordered && NUMBERED.test(line) ? match[3]! : match[3]!];
    const nested: string[] = [];
    index += 1;
    // Continuation lines: deeper indented list items nest; other indented text joins the item.
    while (index < lines.length) {
      const next = lines[index]!;
      if (next.trim() === '') break;
      const nextItem = BULLET.exec(next) ?? NUMBERED.exec(next);
      if (nextItem && nextItem[1]!.length === indent) break;
      if (nextItem && nextItem[1]!.length > indent) {
        nested.push(next);
        index += 1;
        continue;
      }
      if (/^\s+/.test(next) && nested.length === 0) {
        itemText.push(next.trim());
        index += 1;
        continue;
      }
      break;
    }
    items.push({ spans: parseInline(itemText.join(' ')), children: nested.length > 0 ? parseLines(nested.map((entry) => entry.slice(Math.min(indent + 2, leadingSpaces(entry))))) : [] });
  }
  return { block: { kind: 'list', ordered, start: startNumber, items }, end: index - 1 };
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function splitCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*([^*\n]+?)\*|(?<![\w])_([^_\n]+?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<>)\]]+)/g;

/** Inline spans of one line or paragraph: plain text, **bold**, *italic*, `code`, [links](url) and bare URLs. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) spans.push({ kind: 'text', text: text.slice(last, index) });
    const [, , code, bold, boldUnderscore, italic, italicUnderscore, linkText, href, autolink, bareUrl] = match;
    if (code !== undefined) spans.push({ kind: 'code', text: code });
    else if (bold !== undefined || boldUnderscore !== undefined) spans.push({ kind: 'bold', text: (bold ?? boldUnderscore)! });
    else if (italic !== undefined || italicUnderscore !== undefined) spans.push({ kind: 'italic', text: (italic ?? italicUnderscore)! });
    else if (linkText !== undefined && href !== undefined) spans.push({ kind: 'link', text: linkText, href });
    else if (autolink !== undefined) spans.push({ kind: 'link', text: autolink, href: autolink });
    else if (bareUrl !== undefined) spans.push({ kind: 'link', text: bareUrl, href: bareUrl });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) });
  return spans;
}

/** The plain words of spans, for accessibility names and copies. */
export function spansText(spans: readonly InlineSpan[]): string {
  return spans.map((span) => span.text).join('');
}

/** Whether the text has any Markdown structure a plain paragraph would not show. */
export function hasMarkdown(text: string): boolean {
  const blocks = parseMarkdown(text);
  return blocks.some((block) => block.kind !== 'paragraph') || blocks.some((block) => block.kind === 'paragraph' && block.spans.some((span) => span.kind !== 'text'));
}
