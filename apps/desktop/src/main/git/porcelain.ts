import { GitError } from './git-error';

/**
 * Parsers for git's machine-readable ("porcelain") output (AL-080). Each accepts both the `-z`
 * form (NUL-terminated, paths raw; what git-service.ts asks for) and the line form (paths C-quoted
 * when they contain special characters). Pure functions: no git, no I/O.
 */

function parseFailed(what: string, detail: string): GitError {
  return new GitError('PARSE_FAILED', `Could not read ${what} output: ${detail}`);
}

/** Splits `-z` output into records (dropping the final terminator), or line output into lines. */
function records(output: string): { items: string[]; nul: boolean } {
  if (output.includes('\0')) {
    const items = output.split('\0');
    if (items.at(-1) === '') items.pop();
    return { items, nul: true };
  }
  const items = output.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (items.at(-1) === '') items.pop();
  return { items, nul: false };
}

const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Undoes git's C-style path quoting (`"dir/caf\303\251 \"x\".txt"`); unquoted text is returned as is. */
export function unquoteGitPath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const body = text.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    const octal = /^[0-3][0-7]{2}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next] as number);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The first `count` space-separated fields, then the rest of the line (a path may contain spaces). */
function fieldsThenRest(line: string, count: number): { fields: string[]; rest: string } | null {
  const fields: string[] = [];
  let start = 0;
  for (let n = 0; n < count; n++) {
    const space = line.indexOf(' ', start);
    if (space === -1) return null;
    fields.push(line.slice(start, space));
    start = space + 1;
  }
  return { fields, rest: line.slice(start) };
}

// ---------------------------------------------------------------------------------------------
// git status --porcelain=v2 [--branch] [-z]
// ---------------------------------------------------------------------------------------------

/**
 * One changed path. `index` and `worktree` are git's X and Y status letters
 * (`.` unmodified, `M` modified, `T` type changed, `A` added, `D` deleted, `R` renamed, `C` copied, `U` unmerged).
 */
export type StatusEntry =
  | { kind: 'changed'; index: string; worktree: string; submodule: string; path: string }
  | {
      kind: 'renamed' | 'copied';
      index: string;
      worktree: string;
      submodule: string;
      /** Similarity percentage, e.g. 100 for a pure rename. */
      score: number;
      path: string;
      originalPath: string;
    }
  /** A merge conflict; `index`/`worktree` are the conflict letters, e.g. `U`,`U` or `A`,`A`. */
  | { kind: 'unmerged'; index: string; worktree: string; submodule: string; path: string }
  | { kind: 'untracked'; path: string }
  | { kind: 'ignored'; path: string };

export interface StatusBranch {
  /** Commit at HEAD; null before the first commit. */
  oid: string | null;
  /** Checked-out branch name; null when detached. */
  head: string | null;
  detached: boolean;
  /** e.g. `origin/main`; null without an upstream. */
  upstream: string | null;
  /** Commits ahead of / behind the upstream; null without an upstream or when it is gone. */
  ahead: number | null;
  behind: number | null;
}

export interface GitStatus {
  /** Null unless the output was produced with `--branch`. */
  branch: StatusBranch | null;
  entries: StatusEntry[];
  /** Stash count when produced with `--show-stash`, else null. */
  stash: number | null;
}

const STATUS = 'git status --porcelain=v2';

function statusHeader(line: string, status: GitStatus): void {
  const body = line.slice(2);
  const space = body.indexOf(' ');
  const key = space === -1 ? body : body.slice(0, space);
  const value = space === -1 ? '' : body.slice(space + 1);
  if (key === 'stash') {
    status.stash = Number(value);
    return;
  }
  // Git may add headers; parsers are expected to ignore the ones they don't know.
  if (!key.startsWith('branch.')) return;

  const branch = (status.branch ??= {
    oid: null,
    head: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
  });
  switch (key) {
    case 'branch.oid':
      branch.oid = value === '(initial)' ? null : value;
      break;
    case 'branch.head':
      branch.detached = value === '(detached)';
      branch.head = branch.detached ? null : value;
      break;
    case 'branch.upstream':
      branch.upstream = value;
      break;
    case 'branch.ab': {
      const ab = /^\+(\d+) -(\d+)$/.exec(value);
      if (!ab) throw parseFailed(STATUS, `bad branch.ab header "${value}"`);
      branch.ahead = Number(ab[1]);
      branch.behind = Number(ab[2]);
      break;
    }
    default:
      break;
  }
}

export function parseStatusV2(output: string): GitStatus {
  const { items, nul } = records(output);
  const status: GitStatus = { branch: null, entries: [], stash: null };
  const path = (raw: string) => (nul ? raw : unquoteGitPath(raw));

  for (let i = 0; i < items.length; i++) {
    const line = items[i] as string;
    if (line === '') continue;
    const type = line[0];
    if (line.length < 3 || line[1] !== ' ') throw parseFailed(STATUS, `unexpected record "${line.slice(0, 40)}"`);

    if (type === '#') {
      statusHeader(line, status);
    } else if (type === '1') {
      const parsed = fieldsThenRest(line, 8);
      if (!parsed) throw parseFailed(STATUS, `short record "${line}"`);
      const [, xy = '', submodule = ''] = parsed.fields;
      status.entries.push({ kind: 'changed', index: xy[0] ?? '.', worktree: xy[1] ?? '.', submodule, path: path(parsed.rest) });
    } else if (type === '2') {
      const parsed = fieldsThenRest(line, 9);
      if (!parsed) throw parseFailed(STATUS, `short record "${line}"`);
      const [, xy = '', submodule = '', , , , , , xScore = ''] = parsed.fields;
      let target: string;
      let original: string;
      if (nul) {
        target = parsed.rest;
        const next = items[i + 1];
        if (next === undefined) throw parseFailed(STATUS, `rename of "${target}" has no original path`);
        original = next;
        i += 1;
      } else {
        const tab = parsed.rest.indexOf('\t');
        if (tab === -1) throw parseFailed(STATUS, `rename record without a tab "${line}"`);
        target = unquoteGitPath(parsed.rest.slice(0, tab));
        original = unquoteGitPath(parsed.rest.slice(tab + 1));
      }
      status.entries.push({
        kind: xScore.startsWith('C') ? 'copied' : 'renamed',
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.',
        submodule,
        score: Number(xScore.slice(1)) || 0,
        path: target,
        originalPath: original,
      });
    } else if (type === 'u') {
      const parsed = fieldsThenRest(line, 10);
      if (!parsed) throw parseFailed(STATUS, `short record "${line}"`);
      const [, xy = '', submodule = ''] = parsed.fields;
      status.entries.push({ kind: 'unmerged', index: xy[0] ?? 'U', worktree: xy[1] ?? 'U', submodule, path: path(parsed.rest) });
    } else if (type === '?') {
      status.entries.push({ kind: 'untracked', path: path(line.slice(2)) });
    } else if (type === '!') {
      status.entries.push({ kind: 'ignored', path: path(line.slice(2)) });
    } else {
      throw parseFailed(STATUS, `unknown record type "${type}"`);
    }
  }
  return status;
}

/** No staged, unstaged, unmerged or untracked paths (ignored files don't count). */
export function isCleanStatus(status: GitStatus): boolean {
  return status.entries.every((entry) => entry.kind === 'ignored');
}

export function hasConflicts(status: GitStatus): boolean {
  return status.entries.some((entry) => entry.kind === 'unmerged');
}

// ---------------------------------------------------------------------------------------------
// git worktree list --porcelain [-z]
// ---------------------------------------------------------------------------------------------

export interface WorktreeEntry {
  /** As git prints it (forward slashes on Windows). */
  path: string;
  /** Commit at the worktree's HEAD; null for a bare repository. */
  head: string | null;
  /** Full ref, e.g. `refs/heads/71273-cutover`; null when detached or bare. */
  branchRef: string | null;
  /** Short branch name, e.g. `71273-cutover`; null when detached or bare. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockedReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
}

const WORKTREE_LIST = 'git worktree list --porcelain';

function emptyWorktree(path: string): WorktreeEntry {
  return {
    path,
    head: null,
    branchRef: null,
    branch: null,
    detached: false,
    bare: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
  };
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const { items, nul } = records(output);
  const worktrees: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  const reason = (raw: string) => (raw === '' ? null : nul ? raw : unquoteGitPath(raw));

  for (const line of items) {
    if (line === '') {
      current = null;
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);

    if (key === 'worktree') {
      if (value === '') throw parseFailed(WORKTREE_LIST, 'a worktree line has no path');
      current = emptyWorktree(value);
      worktrees.push(current);
      continue;
    }
    if (!current) throw parseFailed(WORKTREE_LIST, `"${key}" appears before any worktree line`);

    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branchRef = value;
        current.branch = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'locked':
        current.locked = true;
        current.lockedReason = reason(value);
        break;
      case 'prunable':
        current.prunable = true;
        current.prunableReason = reason(value);
        break;
      default:
        // New attributes from newer git versions are ignored.
        break;
    }
  }
  return worktrees;
}

// ---------------------------------------------------------------------------------------------
// git rev-list --left-right --count A...B
// ---------------------------------------------------------------------------------------------

/** `left` = commits only in A, `right` = commits only in B. */
export interface LeftRightCount {
  left: number;
  right: number;
}

export function parseLeftRightCount(output: string): LeftRightCount {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(output);
  if (!match) throw parseFailed('git rev-list --left-right --count', `expected two counts, got "${output.trim()}"`);
  return { left: Number(match[1]), right: Number(match[2]) };
}
