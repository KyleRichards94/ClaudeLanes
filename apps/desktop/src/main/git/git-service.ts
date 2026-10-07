import { tmpdir } from 'node:os';
import { normalize } from 'node:path';
import { GitError, isGitError } from './git-error';
import { createGitRunner, type GitRunner, type GitRunnerConfig } from './git-runner';
import {
  GIT_DOWNLOAD_URL,
  MIN_GIT_VERSION,
  compareGitVersions,
  formatGitVersion,
  formatMinimumGitVersion,
  parseGitVersion,
  type GitVersion,
} from './git-version';
import { parseLeftRightCount, parseStatusV2, parseWorktreeList, type GitStatus, type WorktreeEntry } from './porcelain';

/**
 * Main-process git service (design §4 "Git + worktrees", AL-080): the runner plus the typed reads
 * later tickets build on (worktrees AL-083, branch status AL-085, reconciliation AL-090).
 */

export type GitVersionCheck =
  | { ok: true; version: GitVersion }
  | {
      ok: false;
      /** `not-found`: no git on PATH. `too-old`: below MIN_GIT_VERSION. `unknown`: git ran but the version could not be read. */
      reason: 'not-found' | 'too-old' | 'unknown';
      version: GitVersion | null;
      /** One or two sentences for the user: what is needed, what was found, what to do. */
      message: string;
    };

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StatusOptions extends CallOptions {
  /** `--untracked-files`; defaults to `normal` (an untracked folder is one entry). */
  untracked?: 'no' | 'normal' | 'all';
  /** Also list ignored files. */
  ignored?: boolean;
}

export interface AheadBehind {
  /** Commits on `head` that are not on `base`. */
  ahead: number;
  /** Commits on `base` that are not on `head`. */
  behind: number;
}

export interface GitService {
  /** `git(args, { cwd })`: no shell, timeout, typed GitError on failure. */
  readonly run: GitRunner;
  /** The installed version. Throws GitError (`GIT_NOT_FOUND`, `PARSE_FAILED`, …). */
  version(options?: CallOptions): Promise<GitVersion>;
  /** Compares the installed version with MIN_GIT_VERSION. Never throws. */
  checkVersion(options?: CallOptions): Promise<GitVersionCheck>;
  /** Resolves when git is new enough; otherwise throws GitError `GIT_NOT_FOUND` or `GIT_TOO_OLD` with the user-facing message. */
  ensureSupported(options?: CallOptions): Promise<GitVersion>;
  /** `git status --porcelain=v2 --branch -z` in `cwd`, without taking optional locks. */
  status(cwd: string, options?: StatusOptions): Promise<GitStatus>;
  /** `git worktree list --porcelain -z`; paths use the platform's separators. */
  worktrees(cwd: string, options?: CallOptions): Promise<WorktreeEntry[]>;
  /** `git rev-list --left-right --count base...head`. Revisions are never read as options. */
  aheadBehind(cwd: string, base: string, head: string, options?: CallOptions): Promise<AheadBehind>;
}

export interface GitServiceOptions extends GitRunnerConfig {
  /** A ready runner (tests); otherwise one is created from the runner config. */
  runner?: GitRunner;
}

function versionMessage(reason: 'not-found' | 'too-old' | 'unknown', found: string): string {
  const needed = `Agent Lanes needs Git ${formatMinimumGitVersion()} or later`;
  const action = `Install the latest Git from ${GIT_DOWNLOAD_URL}, then restart Agent Lanes.`;
  switch (reason) {
    case 'not-found':
      return `${needed}, and Git was not found on this computer. ${action}`;
    case 'too-old':
      return `${needed}, and this computer has Git ${found}. ${action}`;
    case 'unknown':
      return `${needed}, and the installed version could not be checked (${found}). ${action}`;
  }
}

function requireRevision(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GitError('INVALID_ARGUMENT', `${name} must be a non-empty revision`);
  }
}

export function createGitService(options: GitServiceOptions = {}): GitService {
  const run = options.runner ?? createGitRunner(options);
  let supported: GitVersion | null = null;

  async function version(call: CallOptions = {}): Promise<GitVersion> {
    // `git --version` needs no repository; any existing folder will do.
    const { stdout } = await run(['--version'], { cwd: tmpdir(), ...call });
    const parsed = parseGitVersion(stdout);
    if (!parsed) {
      throw new GitError('PARSE_FAILED', `Could not read the git version from "${stdout.trim().slice(0, 80)}"`, {
        args: ['--version'],
      });
    }
    return parsed;
  }

  async function checkVersion(call: CallOptions = {}): Promise<GitVersionCheck> {
    let found: GitVersion;
    try {
      found = await version(call);
    } catch (error) {
      if (isGitError(error, 'GIT_NOT_FOUND')) {
        return { ok: false, reason: 'not-found', version: null, message: versionMessage('not-found', '') };
      }
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: 'unknown', version: null, message: versionMessage('unknown', detail) };
    }
    if (compareGitVersions(found, MIN_GIT_VERSION) < 0) {
      return { ok: false, reason: 'too-old', version: found, message: versionMessage('too-old', formatGitVersion(found)) };
    }
    return { ok: true, version: found };
  }

  async function ensureSupported(call: CallOptions = {}): Promise<GitVersion> {
    if (supported) return supported;
    const check = await checkVersion(call);
    if (!check.ok) {
      throw new GitError(check.reason === 'not-found' ? 'GIT_NOT_FOUND' : 'GIT_TOO_OLD', check.message, {
        args: ['--version'],
      });
    }
    supported = check.version;
    return supported;
  }

  async function status(cwd: string, call: StatusOptions = {}): Promise<GitStatus> {
    const args = ['status', '--porcelain=v2', '--branch', '-z', `--untracked-files=${call.untracked ?? 'normal'}`];
    if (call.ignored) args.push('--ignored=matching');
    // A background status must not take index.lock away from an agent committing in the same worktree.
    const { stdout } = await run(args, { cwd, signal: call.signal, timeoutMs: call.timeoutMs, env: { GIT_OPTIONAL_LOCKS: '0' } });
    return parseStatusV2(stdout);
  }

  async function worktrees(cwd: string, call: CallOptions = {}): Promise<WorktreeEntry[]> {
    const { stdout } = await run(['worktree', 'list', '--porcelain', '-z'], { cwd, ...call });
    return parseWorktreeList(stdout).map((entry) => ({ ...entry, path: normalize(entry.path) }));
  }

  async function aheadBehind(cwd: string, base: string, head: string, call: CallOptions = {}): Promise<AheadBehind> {
    requireRevision(base, 'base');
    requireRevision(head, 'head');
    const { stdout } = await run(['rev-list', '--left-right', '--count', '--end-of-options', `${base}...${head}`], {
      cwd,
      ...call,
    });
    const { left, right } = parseLeftRightCount(stdout);
    return { ahead: right, behind: left };
  }

  return { run, version, checkVersion, ensureSupported, status, worktrees, aheadBehind };
}
