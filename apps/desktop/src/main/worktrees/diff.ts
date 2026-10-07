import { open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import {
  DIFF_FILE_MAX_BYTES,
  DIFF_MAX_FILES,
  err,
  ok,
  type DiffAgainst,
  type DiffFile,
  type DiffFileStatus,
  type GitDiff,
  type GitDiffFile,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { GitService } from '../git/git-service';
import { isInsidePath } from '../tickets/paths';
import type { TicketRecordStore } from '../tickets/record-store';
import { readWorktreeState, refExists, resolveBaseRef } from './branch-status';

/**
 * The Diff tab's data (AL-089, artboard 3): the files a ticket changed against its base branch, or a
 * sub-branch against the ticket branch, with status and line counts; one file's unified diff on
 * demand. Diffs start at the merge base, so changes that landed on the base meanwhile don't show,
 * and include the worktree's uncommitted and untracked files while it exists.
 *
 * Binary files and diffs over DIFF_FILE_MAX_BYTES come back as placeholders, never raw content.
 */
export interface DiffService {
  files(ticketId: string, against: DiffAgainst): Promise<Result<GitDiff>>;
  file(ticketId: string, against: DiffAgainst, path: string, oldPath?: string): Promise<Result<GitDiffFile>>;
}

export interface DiffServiceOptions {
  git: Pick<GitService, 'run' | 'status'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  /** Largest diff returned per file; tests lower it. */
  maxFileBytes?: number;
}

const HEADS = 'refs/heads/';
/** Paths are taken literally: `:(top)` or `*.cs` from the renderer is a file name, not a pathspec. */
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' } as const;
const DIFF = ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--no-relative'];
/** How much of a new file is checked for NUL bytes, as git does. */
const BINARY_SNIFF_BYTES = 8_000;

/** Where a diff runs: from the merge base to the worktree (or the branch tip when the worktree is gone). */
interface DiffRange {
  fromRef: string;
  fromCommit: string;
  toRef: string;
  /** `[mergeBase]` against the worktree, or `[mergeBase, branchRef]` without one. */
  revisions: string[];
  /** The worktree, or the repo when the worktree is gone. */
  cwd: string;
  worktree: boolean;
}

class DiffRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

const STATUS_LETTERS: Record<string, DiffFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
};

/** `git diff --name-status -z`: status, then one path (two for a rename or copy). */
export function parseNameStatus(output: string): { status: DiffFileStatus; path: string; oldPath: string | null }[] {
  const items = output.split('\0');
  const files: { status: DiffFileStatus; path: string; oldPath: string | null }[] = [];
  for (let i = 0; i < items.length; i++) {
    const code = items[i] ?? '';
    if (code === '') continue;
    const status = STATUS_LETTERS[code[0] ?? ''] ?? 'modified';
    if (status === 'renamed' || status === 'copied') {
      files.push({ status, oldPath: items[i + 1] ?? '', path: items[i + 2] ?? '' });
      i += 2;
    } else {
      files.push({ status, oldPath: null, path: items[i + 1] ?? '' });
      i += 1;
    }
  }
  return files;
}

/** `git diff --numstat -z`: `added\tdeleted\tpath`, or `added\tdeleted\t` then old and new paths; `-` for binary. */
export function parseNumstat(output: string): Map<string, { additions: number | null; deletions: number | null }> {
  const items = output.split('\0');
  const stats = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let i = 0; i < items.length; i++) {
    const line = items[i] ?? '';
    if (line === '') continue;
    const [added = '-', deleted = '-', path = ''] = line.split('\t');
    const counts = { additions: added === '-' ? null : Number(added), deletions: deleted === '-' ? null : Number(deleted) };
    if (path === '') {
      // A rename: the old and new paths follow as their own records.
      stats.set(items[i + 2] ?? '', counts);
      i += 2;
    } else {
      stats.set(path, counts);
    }
  }
  return stats;
}

/** A relative path that stays inside the worktree, with `/` separators; null otherwise. */
export function safeRelativePath(path: string): string | null {
  if (path.includes('\0') || isAbsolute(path) || /^[a-zA-Z]:/.test(path)) return null;
  const normalized = posix.normalize(path.replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) return null;
  return normalized;
}

/** Reads the start of a file: its size, and whether it looks binary (a NUL byte), as git decides. */
async function sniff(file: string): Promise<{ size: number; binary: boolean }> {
  const { size } = await stat(file);
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, BINARY_SNIFF_BYTES));
    await handle.read(buffer, 0, buffer.length, 0);
    return { size, binary: buffer.includes(0) };
  } finally {
    await handle.close();
  }
}

function lineCount(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** A unified diff that adds the whole of an untracked file, as `git diff --no-index /dev/null file` prints it. */
function newFilePatch(path: string, text: string): string {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  const body = lines.map((line) => `+${line}`).join('\n');
  const noNewline = text !== '' && !text.endsWith('\n') ? '\n\\ No newline at end of file' : '';
  const hunk = lines.length === 0 ? '' : `@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@\n${body}${noNewline}\n`;
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n${hunk}`;
}

export function createDiffService(options: DiffServiceOptions): DiffService {
  const { git, tickets } = options;
  const maxFileBytes = options.maxFileBytes ?? DIFF_FILE_MAX_BYTES;

  async function rangeFor(record: TicketRecord, against: DiffAgainst): Promise<DiffRange> {
    const { repo } = record;
    let fromRef: string;
    let from: string;
    let toRef: string;
    let worktreePath: string;
    if (against.kind === 'base') {
      const base = await resolveBaseRef(git, repo, record.baseBranch);
      if (!base) throw new DiffRefusal('base-not-found', `The base branch ${record.baseBranch} was not found locally or on origin.`);
      fromRef = base.name;
      from = base.ref;
      toRef = record.branch;
      worktreePath = record.worktreePath;
    } else {
      const sub = record.subBranches.find((entry) => entry.branch === against.branch);
      if (!sub) throw new DiffRefusal('sub-branch-not-found', `${against.branch} is not a sub-branch of ticket ${record.id}.`);
      fromRef = record.branch;
      from = `${HEADS}${record.branch}`;
      toRef = sub.branch;
      worktreePath = sub.worktreePath;
    }
    const to = `${HEADS}${toRef}`;
    if (!(await refExists(git, repo, from)) || !(await refExists(git, repo, to))) {
      throw new DiffRefusal('branch-missing', `${(await refExists(git, repo, to)) ? fromRef : toRef} no longer exists.`);
    }
    const fromCommit = (await git.run(['merge-base', from, to], { cwd: repo })).stdout.trim();
    const worktree = (await readWorktreeState(git, worktreePath)).present;
    return {
      fromRef,
      fromCommit,
      toRef,
      revisions: worktree ? [fromCommit] : [fromCommit, to],
      cwd: worktree ? worktreePath : repo,
      worktree,
    };
  }

  async function untrackedFiles(range: DiffRange): Promise<string[]> {
    if (!range.worktree) return [];
    const status = await git.status(range.cwd, { untracked: 'all' });
    return status.entries.filter((entry) => entry.kind === 'untracked').map((entry) => entry.path);
  }

  async function untrackedFile(range: DiffRange, path: string): Promise<DiffFile> {
    const file: DiffFile = { path, oldPath: null, status: 'untracked', additions: null, deletions: 0, binary: false };
    try {
      const { size, binary } = await sniff(join(range.cwd, path));
      if (binary) return { ...file, deletions: null, binary: true };
      if (size > maxFileBytes) return file;
      return { ...file, additions: lineCount(await readFile(join(range.cwd, path), 'utf8')) };
    } catch {
      return file;
    }
  }

  async function listFiles(record: TicketRecord, against: DiffAgainst): Promise<GitDiff> {
    const range = await rangeFor(record, against);
    const run = (format: string) =>
      git.run([...DIFF, format, '-z', ...range.revisions, '--'], { cwd: range.cwd, env: LITERAL, maxOutputBytes: 64 * 1024 * 1024 });
    const [names, numstat] = await Promise.all([run('--name-status'), run('--numstat')]);
    const stats = parseNumstat(numstat.stdout);
    const tracked: DiffFile[] = parseNameStatus(names.stdout).map((entry) => {
      const counts = stats.get(entry.path);
      const binary = counts !== undefined && counts.additions === null;
      return { ...entry, additions: counts?.additions ?? (binary ? null : 0), deletions: counts?.deletions ?? (binary ? null : 0), binary };
    });
    const untrackedPaths = await untrackedFiles(range);
    const all = tracked.length + untrackedPaths.length;
    const untracked = await Promise.all(untrackedPaths.slice(0, Math.max(0, DIFF_MAX_FILES - tracked.length)).map((path) => untrackedFile(range, path)));
    const files = [...tracked, ...untracked].slice(0, DIFF_MAX_FILES).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return {
      ticketId: record.id,
      against,
      fromRef: range.fromRef,
      fromCommit: range.fromCommit,
      toRef: range.toRef,
      includesUncommitted: range.worktree,
      files,
      truncated: all > files.length,
      totals: {
        files: all,
        additions: [...tracked, ...untracked].reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: [...tracked, ...untracked].reduce((sum, file) => sum + (file.deletions ?? 0), 0),
      },
    };
  }

  async function oneFile(record: TicketRecord, against: DiffAgainst, rawPath: string, rawOldPath?: string): Promise<GitDiffFile> {
    const path = safeRelativePath(rawPath);
    const oldPath = rawOldPath === undefined ? null : safeRelativePath(rawOldPath);
    if (path === null || (rawOldPath !== undefined && oldPath === null)) {
      throw new DiffRefusal('invalid-path', `"${rawPath}" is not a path inside the worktree.`);
    }
    const range = await rangeFor(record, against);
    const paths = oldPath ? [oldPath, path] : [path];

    const numstat = await git.run([...DIFF, '--numstat', '-z', ...range.revisions, '--', ...paths], { cwd: range.cwd, env: LITERAL });
    if (numstat.stdout === '') {
      // Not changed in git's eyes: an untracked file, read here (only inside the worktree).
      const untracked = range.worktree ? (await untrackedFiles(range)).includes(path) : false;
      const target = join(range.cwd, path);
      if (!untracked || !isInsidePath(target, range.cwd)) return { kind: 'text', path, patch: '' };
      const { size, binary } = await sniff(target);
      if (binary) return { kind: 'binary', path };
      if (size > maxFileBytes) return { kind: 'too-large', path, bytes: size, limit: maxFileBytes };
      const patch = newFilePatch(path, await readFile(target, 'utf8'));
      if (Buffer.byteLength(patch) > maxFileBytes) return { kind: 'too-large', path, bytes: size, limit: maxFileBytes };
      return { kind: 'text', path, patch };
    }
    if ([...parseNumstat(numstat.stdout).values()].some((counts) => counts.additions === null)) return { kind: 'binary', path };

    try {
      const { stdout } = await git.run([...DIFF, ...range.revisions, '--', ...paths], { cwd: range.cwd, env: LITERAL, maxOutputBytes: maxFileBytes });
      return { kind: 'text', path, patch: stdout };
    } catch (error) {
      if (isGitError(error, 'OUTPUT_TOO_LARGE')) return { kind: 'too-large', path, bytes: null, limit: maxFileBytes };
      throw error;
    }
  }

  async function guarded<T>(ticketId: string, task: (record: TicketRecord) => Promise<T>): Promise<Result<T>> {
    const record = await tickets.get(ticketId);
    if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found', ticketId });
    try {
      return ok(await task(record));
    } catch (error) {
      if (error instanceof DiffRefusal) return err('VALIDATION', error.message, { reason: error.reason });
      if (isGitError(error)) return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode });
      throw error;
    }
  }

  return {
    files: (ticketId, against) => guarded(ticketId, (record) => listFiles(record, against)),
    file: (ticketId, against, path, oldPath) => guarded(ticketId, (record) => oneFile(record, against, path, oldPath)),
  };
}
