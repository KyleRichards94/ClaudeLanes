import type { DiffFile, DiffFileStatus } from '@agent-lanes/contracts';

/** One line of a unified diff as the Diff tab draws it (AL-179). */
export interface DiffLine {
  kind: 'hunk' | 'add' | 'remove' | 'context' | 'note';
  /** The line without its leading `+`, `-` or space; the whole header for a hunk. */
  text: string;
  /** Line numbers in the old and new file; null where the line is not on that side. */
  oldLine: number | null;
  newLine: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Git's unified diff → the lines to draw. The file headers before the first hunk (`diff --git`,
 * `index`, `---`, `+++`, mode changes) are left out: the file row already says what changed.
 * "\ No newline at end of file" is kept as a note.
 */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const raw = patch.split('\n');
  // A trailing newline leaves one empty string that is not a line of the diff.
  if (raw.at(-1) === '') raw.pop();

  for (const text of raw) {
    const hunk = HUNK.exec(text);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: 'hunk', text, oldLine: null, newLine: null });
      continue;
    }
    if (!inHunk) continue;
    const sign = text[0];
    if (sign === '+') {
      lines.push({ kind: 'add', text: text.slice(1), oldLine: null, newLine: newLine++ });
    } else if (sign === '-') {
      lines.push({ kind: 'remove', text: text.slice(1), oldLine: oldLine++, newLine: null });
    } else if (sign === '\\') {
      lines.push({ kind: 'note', text: text.slice(1).trim(), oldLine: null, newLine: null });
    } else if (sign === ' ' || text === '') {
      lines.push({ kind: 'context', text: text.slice(1), oldLine: oldLine++, newLine: newLine++ });
    } else {
      // The next file's header in a multi-file patch: stop numbering until its first hunk.
      inHunk = false;
    }
  }
  return lines;
}

const STATUS_LETTERS: Record<DiffFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  unmerged: 'U',
  untracked: 'A',
};

const STATUS_WORDS: Record<DiffFileStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  'type-changed': 'Type changed',
  unmerged: 'Unmerged',
  untracked: 'New, not committed',
};

/** The file row's status letter (A, M, D, R…) and the word a screen reader hears. */
export function diffStatus(status: DiffFileStatus): { letter: string; word: string } {
  return { letter: STATUS_LETTERS[status], word: STATUS_WORDS[status] };
}

/** `+214 −8`, or `binary`. */
export function diffStats(file: Pick<DiffFile, 'additions' | 'deletions' | 'binary'>): string {
  if (file.binary || file.additions === null || file.deletions === null) return 'binary';
  return `+${file.additions} −${file.deletions}`;
}

/** `12 files`, `1 file`. */
export function fileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/** `256 KB`, `1.4 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
