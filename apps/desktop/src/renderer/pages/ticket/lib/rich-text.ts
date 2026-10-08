/**
 * Azure DevOps rich text (work item descriptions, acceptance criteria, comments) → plain blocks of
 * styled text (AL-180, R6). ADO stores these fields as HTML written by anyone with access to the
 * project, so the app never renders it as HTML: this reads the markup as a stream of tags and text,
 * keeps only the words and a little structure (paragraphs, headings, list items, bold, italic, code,
 * http(s) links), and drops everything else, attributes and scripts included. The result is drawn with
 * React Native `Text`, which cannot run markup.
 */

export interface RichSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** An http(s) link's target; any other scheme is dropped and the words stay as plain text. */
  href?: string;
}

export interface RichBlock {
  kind: 'paragraph' | 'heading' | 'list-item' | 'quote' | 'code';
  spans: RichSpan[];
  /** `•` or `1.` for a list item. */
  marker?: string;
  /** List nesting, from 1. */
  depth?: number;
}

/** Elements whose content is never text the reader should see. */
const SKIPPED = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template', 'canvas', 'video', 'audio', 'select', 'textarea', 'button']);
/** Elements that start and end a block of their own. */
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'dl', 'dt', 'dd', 'hr', 'form', 'fieldset', 'address', 'details', 'summary']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BOLD = new Set(['b', 'strong']);
const ITALIC = new Set(['i', 'em', 'cite', 'u']);
const CODE = new Set(['code', 'kbd', 'samp', 'tt']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'wbr', 'source', 'track', 'param', 'embed']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  rarr: '→',
  larr: '←',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
};

/** `&amp;`, `&#39;`, `&#x2192;` → their characters; an unknown entity stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      // Control characters and lone surrogates are not text.
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code >= 0x7f && code < 0xa0)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? '');
}

/** Only absolute http(s) links survive; `javascript:`, `data:`, `file:` and relative links do not. */
export function safeHref(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

interface ListFrame {
  ordered: boolean;
  next: number;
}

/** A `<br>` until the block is tidied: not HTML whitespace, so collapsing leaves it alone. */
const BREAK = '\u2028';

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;

/** Reads ADO HTML into blocks. Never throws: markup it can't read is left out, its text kept. */
export function htmlToBlocks(html: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const lists: ListFrame[] = [];
  let spans: RichSpan[] = [];
  let kind: RichBlock['kind'] = 'paragraph';
  let marker: string | undefined;
  let depth: number | undefined;
  let skip: string | null = null;
  let skipDepth = 0;
  let bold = 0;
  let italic = 0;
  let code = 0;
  let pre = 0;
  let quote = 0;
  const links: (string | undefined)[] = [];

  const flush = () => {
    const tidy = tidySpans(spans, kind === 'code');
    if (tidy.length > 0) {
      const block: RichBlock = { kind, spans: tidy };
      if (marker !== undefined) block.marker = marker;
      if (depth !== undefined) block.depth = depth;
      blocks.push(block);
    }
    spans = [];
    kind = pre > 0 ? 'code' : quote > 0 ? 'quote' : 'paragraph';
    marker = undefined;
    depth = undefined;
  };

  const push = (text: string) => {
    if (text === '') return;
    const span: RichSpan = { text };
    if (bold > 0 || kind === 'heading') span.bold = true;
    if (italic > 0) span.italic = true;
    if (code > 0 || pre > 0) span.code = true;
    const href = links.at(-1);
    if (href) span.href = href;
    spans.push(span);
  };

  for (const match of html.matchAll(TOKEN)) {
    const [token, closing, rawName, attrs = ''] = match;
    if (rawName === undefined) {
      if (skip !== null || token.startsWith('<!') || token.startsWith('<?')) continue;
      // A lone `<` that starts no tag is text.
      push(decodeEntities(token));
      continue;
    }
    const name = rawName.toLowerCase();
    const selfClosing = /\/\s*$/.test(attrs) || VOID.has(name);

    if (skip !== null) {
      if (name === skip) skipDepth += closing ? -1 : selfClosing ? 0 : 1;
      if (skipDepth === 0) skip = null;
      continue;
    }
    if (SKIPPED.has(name)) {
      if (!closing && !selfClosing) {
        skip = name;
        skipDepth = 1;
      }
      continue;
    }

    if (closing) {
      if (BOLD.has(name)) bold = Math.max(0, bold - 1);
      else if (ITALIC.has(name)) italic = Math.max(0, italic - 1);
      else if (CODE.has(name)) code = Math.max(0, code - 1);
      else if (name === 'a') links.pop();
      else if (name === 'pre') {
        flush();
        pre = Math.max(0, pre - 1);
        kind = pre > 0 ? 'code' : quote > 0 ? 'quote' : 'paragraph';
      } else if (name === 'blockquote') {
        flush();
        quote = Math.max(0, quote - 1);
        kind = quote > 0 ? 'quote' : 'paragraph';
      } else if (name === 'ul' || name === 'ol') {
        flush();
        lists.pop();
      } else if (name === 'li' || HEADINGS.has(name) || BLOCKS.has(name)) flush();
      else if (name === 'td' || name === 'th') push(' ');
      continue;
    }

    if (BOLD.has(name)) bold += 1;
    else if (ITALIC.has(name)) italic += 1;
    else if (CODE.has(name)) code += 1;
    else if (name === 'a') links.push(safeHref(attribute(attrs, 'href')));
    else if (name === 'br') push(BREAK);
    else if (name === 'img') {
      const alt = attribute(attrs, 'alt')?.trim();
      push(alt ? `[Image: ${alt}]` : '[Image]');
    } else if (name === 'pre') {
      flush();
      pre += 1;
      kind = 'code';
    } else if (name === 'blockquote') {
      flush();
      quote += 1;
      kind = 'quote';
    } else if (name === 'ul' || name === 'ol') {
      flush();
      const start = Number.parseInt(attribute(attrs, 'start') ?? '1', 10);
      lists.push({ ordered: name === 'ol', next: Number.isFinite(start) ? start : 1 });
    } else if (name === 'li') {
      flush();
      const list = lists.at(-1);
      kind = 'list-item';
      depth = Math.max(lists.length, 1);
      marker = list?.ordered ? `${list.next++}.` : '•';
    } else if (HEADINGS.has(name)) {
      flush();
      kind = 'heading';
    } else if (BLOCKS.has(name)) flush();
  }
  flush();
  return blocks;
}

/** Collapses HTML whitespace (not inside `pre`), trims the block's ends and merges same-styled neighbours. */
function tidySpans(spans: readonly RichSpan[], preformatted: boolean): RichSpan[] {
  const out: RichSpan[] = [];
  for (const span of spans) {
    let text = preformatted ? span.text.replace(/\r\n?/g, '\n') : span.text.replace(/[ \t\r\n\f]+/g, ' ');
    const previous = out.at(-1)?.text ?? '';
    // Drop a space that opens the block or follows a space or a line break.
    if (!preformatted && text.startsWith(' ') && (previous === '' || previous.endsWith(' ') || previous.endsWith(BREAK))) text = text.slice(1);
    if (text === '') continue;
    const last = out.at(-1);
    if (last && sameStyle(last, span)) out[out.length - 1] = { ...last, text: last.text + text };
    else out.push({ ...span, text });
  }
  const lines = out.map((span) => ({ ...span, text: span.text.split(BREAK).join('\n').replace(/ \n/g, '\n') }));
  // Trim the block's ends; a block of only whitespace is no block.
  while (lines.length > 0) {
    const first = lines[0]!;
    const trimmed = first.text.replace(preformatted ? /^\n+/ : /^\s+/, '');
    if (trimmed !== '') {
      lines[0] = { ...first, text: trimmed };
      break;
    }
    lines.shift();
  }
  while (lines.length > 0) {
    const last = lines.at(-1)!;
    const trimmed = last.text.replace(/\s+$/, '');
    if (trimmed !== '') {
      lines[lines.length - 1] = { ...last, text: trimmed };
      break;
    }
    lines.pop();
  }
  return lines;
}

function sameStyle(a: RichSpan, b: RichSpan): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code && a.href === b.href;
}

/**
 * A Markdown comment → blocks, without interpreting it: blank lines split paragraphs, `-`, `*` and
 * `1.` lines are list items, `#` lines headings. Emphasis markers stay as typed.
 */
export function markdownToBlocks(markdown: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', spans: [{ text }] });
    lines = [];
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (line.trim() === '') flush();
    else if (bullet) {
      flush();
      blocks.push({ kind: 'list-item', marker: '•', depth: 1, spans: [{ text: bullet[1]!.trim() }] });
    } else if (numbered) {
      flush();
      blocks.push({ kind: 'list-item', marker: `${numbered[1]}.`, depth: 1, spans: [{ text: numbered[2]!.trim() }] });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', spans: [{ text: heading[1]!.trim(), bold: true }] });
    } else lines.push(line);
  }
  flush();
  return blocks;
}
