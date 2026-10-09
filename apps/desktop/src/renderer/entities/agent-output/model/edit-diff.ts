/**
 * The inline diff an expanded Edit or Write row shows (AL-256): the lines of `before` and `after`
 * as context, removed and added lines. A line-level LCS; the texts are an Edit's old and new
 * strings, which are small, so the O(n·m) table is cheap. Over `maxLines` the middle is folded.
 */
export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed';
  readonly text: string;
}

const MAX_TABLE = 400;

export function editDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length === 0) return b.map((text) => ({ kind: 'added', text }));
  if (b.length === 0) return a.map((text) => ({ kind: 'removed', text }));
  if (a.length > MAX_TABLE || b.length > MAX_TABLE) {
    // Too big for a table: everything old removed, everything new added.
    return [...a.map((text): DiffLine => ({ kind: 'removed', text })), ...b.map((text): DiffLine => ({ kind: 'added', text }))];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) lines.push({ kind: 'removed', text: a[i++]! });
  while (j < b.length) lines.push({ kind: 'added', text: b[j++]! });
  return lines;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
