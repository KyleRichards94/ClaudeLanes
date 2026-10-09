/**
 * Syntax colouring for fenced code in the agent's prose (AL-255): a line tokeniser per language
 * family, enough to tint keywords, strings, comments and numbers in the languages the repos use
 * (C#, VB, TypeScript, JSON, XML and Razor, PowerShell, shell, SQL, CSS, YAML, Python) and to
 * colour diff lines. Unknown languages get plain text. Not a parser: a string across lines is
 * carried from line to line only for block comments.
 */

export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'tag' | 'added' | 'removed' | 'meta';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

export type Language = 'csharp' | 'vb' | 'typescript' | 'json' | 'xml' | 'powershell' | 'shell' | 'sql' | 'css' | 'yaml' | 'python' | 'diff' | 'plain';

const ALIASES: Record<string, Language> = {
  cs: 'csharp',
  csharp: 'csharp',
  'c#': 'csharp',
  vb: 'vb',
  vbnet: 'vb',
  'vb.net': 'vb',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  javascript: 'typescript',
  mjs: 'typescript',
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  html: 'xml',
  razor: 'xml',
  cshtml: 'xml',
  xaml: 'xml',
  svg: 'xml',
  csproj: 'xml',
  vbproj: 'xml',
  ps: 'powershell',
  ps1: 'powershell',
  powershell: 'powershell',
  pwsh: 'powershell',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  zsh: 'shell',
  console: 'shell',
  cmd: 'shell',
  bat: 'shell',
  sql: 'sql',
  tsql: 'sql',
  css: 'css',
  scss: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  python: 'python',
  diff: 'diff',
  patch: 'diff',
  text: 'plain',
  txt: 'plain',
  plain: 'plain',
};

/** The language family a fence's tag belongs to; `plain` for none or an unknown one. */
export function languageOf(tag: string | null | undefined): Language {
  if (!tag) return 'plain';
  return ALIASES[tag.trim().toLowerCase()] ?? 'plain';
}

interface Grammar {
  keywords: ReadonlySet<string>;
  caseInsensitive?: boolean;
  lineComment: readonly string[];
  blockComment?: readonly [open: string, close: string];
  strings: readonly string[];
  /** Strings that may run across lines (verbatim, template). */
  multilineStrings?: readonly string[];
  /** Words beginning with this are keywords too (`$name` in PowerShell is a variable, tinted as a keyword). */
  variablePrefix?: string;
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean));

const GRAMMARS: Record<Exclude<Language, 'diff' | 'plain' | 'xml'>, Grammar> = {
  csharp: {
    keywords: words(
      'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while yield',
    ),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    strings: ['"', "'"],
    multilineStrings: ['@"', '"""'],
  },
  vb: {
    keywords: words(
      'AddHandler AddressOf Alias And AndAlso As Boolean ByRef Byte ByVal Call Case Catch CBool CByte CChar CDate CDbl CDec Char CInt Class CLng CObj Const Continue CSByte CShort CSng CStr CType CUInt CULng CUShort Date Decimal Declare Default Delegate Dim DirectCast Do Double Each Else ElseIf End EndIf Enum Erase Error Event Exit False Finally For Friend Function Get GetType GetXMLNamespace Global GoSub GoTo Handles If Implements Imports In Inherits Integer Interface Is IsNot Let Lib Like Long Loop Me Mod Module MustInherit MustOverride MyBase MyClass Namespace Narrowing New Next Not Nothing NotInheritable NotOverridable Object Of On Operator Option Optional Or OrElse Out Overloads Overridable Overrides ParamArray Partial Private Property Protected Public RaiseEvent ReadOnly ReDim REM RemoveHandler Resume Return SByte Select Set Shadows Shared Short Single Static Step Stop String Structure Sub SyncLock Then Throw To True Try TryCast TypeOf UInteger ULong UShort Using Variant Wend When While Widening With WithEvents WriteOnly Xor',
    ),
    caseInsensitive: true,
    lineComment: ["'"],
    strings: ['"'],
  },
  typescript: {
    keywords: words(
      'abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let module namespace never new null number of override package private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
    ),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
    strings: ['"', "'"],
    multilineStrings: ['`'],
  },
  json: { keywords: words('true false null'), lineComment: ['//'], blockComment: ['/*', '*/'], strings: ['"'] },
  powershell: {
    keywords: words(
      'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in inlinescript parallel param process return sequence switch throw trap try until using var while workflow -eq -ne -gt -ge -lt -le -like -notlike -match -notmatch -and -or -not',
    ),
    caseInsensitive: true,
    lineComment: ['#'],
    blockComment: ['<#', '#>'],
    strings: ['"', "'"],
    variablePrefix: '$',
  },
  shell: {
    keywords: words('if then else elif fi for while until do done case esac in function select time export local readonly return exit set unset shift source sudo cd ls rm cp mv mkdir echo cat grep git npm pnpm dotnet node'),
    lineComment: ['#'],
    strings: ['"', "'"],
    variablePrefix: '$',
  },
  sql: {
    keywords: words(
      'select from where insert into values update set delete create table alter drop index view as join left right inner outer on group by order having limit offset distinct union all and or not null is in exists between like case when then else end begin commit rollback transaction primary key foreign references default constraint int varchar nvarchar bit datetime declare exec procedure function returns go with top',
    ),
    caseInsensitive: true,
    lineComment: ['--'],
    blockComment: ['/*', '*/'],
    strings: ["'"],
  },
  css: { keywords: words('important inherit initial unset none auto flex grid block inline absolute relative fixed sticky'), lineComment: [], blockComment: ['/*', '*/'], strings: ['"', "'"] },
  yaml: { keywords: words('true false null yes no on off'), lineComment: ['#'], strings: ['"', "'"] },
  python: {
    keywords: words('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self print'),
    lineComment: ['#'],
    strings: ['"', "'"],
    multilineStrings: ['"""', "'''"],
  },
};

const NUMBER = /^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?[fdmlu]*)\b/i;
const WORD = /^[A-Za-z_$@][\w$-]*/;

/** The tokens of each line of `code`, one array per line. */
export function highlight(code: string, language: Language): Token[][] {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  if (language === 'plain') return lines.map((line) => (line === '' ? [] : [{ kind: 'plain', text: line }]));
  if (language === 'diff') return lines.map(diffLine);
  if (language === 'xml') return lines.map(xmlLine);
  const grammar = GRAMMARS[language];
  let inBlockComment = false;
  let inMultiline: string | null = null;
  return lines.map((line) => {
    const result = tokeniseLine(line, grammar, inBlockComment, inMultiline);
    inBlockComment = result.inBlockComment;
    inMultiline = result.inMultiline;
    return result.tokens;
  });
}

function diffLine(line: string): Token[] {
  if (line === '') return [];
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) return [{ kind: 'meta', text: line }];
  if (line.startsWith('+')) return [{ kind: 'added', text: line }];
  if (line.startsWith('-')) return [{ kind: 'removed', text: line }];
  return [{ kind: 'plain', text: line }];
}

const XML_TAG = /<\/?[A-Za-z][\w:.-]*|\/?>/g;

function xmlLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  const push = (kind: TokenKind, text: string) => {
    if (text !== '') tokens.push({ kind, text });
  };
  if (line.trim().startsWith('<!--')) return [{ kind: 'comment', text: line }];
  for (const match of line.matchAll(XML_TAG)) {
    push('plain', line.slice(last, match.index));
    push('tag', match[0]);
    last = match.index + match[0].length;
  }
  push('plain', line.slice(last));
  // Attribute values in quotes read as strings.
  return tokens.flatMap((token) => (token.kind === 'plain' ? splitStrings(token.text) : [token]));
}

function splitStrings(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(/"[^"]*"|'[^']*'/g)) {
    if (match.index > last) out.push({ kind: 'plain', text: text.slice(last, match.index) });
    out.push({ kind: 'string', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'plain', text: text.slice(last) });
  return out;
}

function tokeniseLine(line: string, grammar: Grammar, startInBlockComment: boolean, startMultiline: string | null): { tokens: Token[]; inBlockComment: boolean; inMultiline: string | null } {
  const tokens: Token[] = [];
  let plain = '';
  let inBlockComment = startInBlockComment;
  let inMultiline = startMultiline;
  const flush = () => {
    if (plain !== '') tokens.push({ kind: 'plain', text: plain });
    plain = '';
  };
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);

    if (inBlockComment) {
      const close = grammar.blockComment![1];
      const end = rest.indexOf(close);
      flush();
      if (end === -1) {
        tokens.push({ kind: 'comment', text: rest });
        return { tokens, inBlockComment: true, inMultiline };
      }
      tokens.push({ kind: 'comment', text: rest.slice(0, end + close.length) });
      index += end + close.length;
      inBlockComment = false;
      continue;
    }

    if (inMultiline !== null) {
      const closer = inMultiline === '@"' ? '"' : inMultiline;
      const end = rest.indexOf(closer);
      flush();
      if (end === -1) {
        tokens.push({ kind: 'string', text: rest });
        return { tokens, inBlockComment, inMultiline };
      }
      tokens.push({ kind: 'string', text: rest.slice(0, end + closer.length) });
      index += end + closer.length;
      inMultiline = null;
      continue;
    }

    const lineComment = grammar.lineComment.find((marker) => rest.startsWith(marker));
    // A `'` starts a comment in VB but a string elsewhere; VB has no `'` strings, so the order below is right.
    if (lineComment && !(lineComment === '#' && index > 0 && /[\w$]/.test(line[index - 1]!))) {
      flush();
      tokens.push({ kind: 'comment', text: rest });
      return { tokens, inBlockComment, inMultiline };
    }

    if (grammar.blockComment && rest.startsWith(grammar.blockComment[0])) {
      inBlockComment = true;
      continue;
    }

    const multiline = grammar.multilineStrings?.find((marker) => rest.startsWith(marker));
    if (multiline) {
      flush();
      const closer = multiline === '@"' ? '"' : multiline;
      const end = rest.indexOf(closer, multiline.length);
      if (end === -1) {
        tokens.push({ kind: 'string', text: rest });
        return { tokens, inBlockComment, inMultiline: multiline };
      }
      tokens.push({ kind: 'string', text: rest.slice(0, end + closer.length) });
      index += end + closer.length;
      continue;
    }

    const quote = grammar.strings.find((marker) => rest.startsWith(marker));
    if (quote) {
      flush();
      let end = 1;
      while (end < rest.length && rest[end] !== quote) end += rest[end] === '\\' ? 2 : 1;
      const text = rest.slice(0, Math.min(end + 1, rest.length));
      tokens.push({ kind: 'string', text });
      index += text.length;
      continue;
    }

    const number = NUMBER.exec(rest);
    if (number && (index === 0 || !/[\w$]/.test(line[index - 1]!))) {
      flush();
      tokens.push({ kind: 'number', text: number[0] });
      index += number[0].length;
      continue;
    }

    const word = WORD.exec(rest);
    if (word) {
      const text = word[0];
      const key = grammar.caseInsensitive ? text.toLowerCase() : text;
      const isKeyword = grammar.keywords.has(key) || (grammar.caseInsensitive && [...grammar.keywords].some((entry) => entry.toLowerCase() === key)) || (grammar.variablePrefix !== undefined && text.startsWith(grammar.variablePrefix));
      if (isKeyword) {
        flush();
        tokens.push({ kind: 'keyword', text });
      } else plain += text;
      index += text.length;
      continue;
    }

    plain += line[index]!;
    index += 1;
  }
  flush();
  return { tokens, inBlockComment, inMultiline };
}
