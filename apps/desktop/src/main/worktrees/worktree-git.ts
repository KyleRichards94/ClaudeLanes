import { lstat, mkdir, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isGitError, type GitError } from '../git/git-error';
import type { CallOptions, GitService } from '../git/git-service';
import { isSameRepoPath } from '../repos/repo-paths';
import { isInsidePath } from '../tickets/paths';

/**
 * The git steps behind a ticket worktree (AL-083, design §9 step 1), each on its own so the service
 * can stop and roll back between them. Every call goes through the AL-080 runner: no shell, typed
 * GitError, credentials redacted.
 */

/** The git calls these steps need; tests pass a service built on an isolated runner. */
export type WorktreeGit = Pick<GitService, 'run' | 'worktrees' | 'ensureSupported'>;

const HEADS = 'refs/heads/';
const ORIGIN = 'refs/remotes/origin/';

/**
 * Local branch names plus origin's without the `origin/` prefix (as AL-082's naming expects), so a
 * new branch clashes with neither now nor when it is pushed.
 */
export async function listBranchNames(git: WorktreeGit, repo: string, call: CallOptions = {}): Promise<string[]> {
  const { stdout } = await git.run(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'], { cwd: repo, ...call });
  const names = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const ref = line.trim();
    if (ref.startsWith(HEADS)) names.add(ref.slice(HEADS.length));
    else if (ref.startsWith(ORIGIN) && ref !== `${ORIGIN}HEAD`) names.add(ref.slice(ORIGIN.length));
  }
  return [...names];
}

/** Failures that mean "origin can't give us the base right now"; the ticket then starts from the local base. */
const FETCH_FALLBACK_ERRORS = ['COMMAND_FAILED', 'TIMEOUT'] as const;

/** Git's own one-line reason (`fatal: …` without the prefix), or the GitError message. */
function gitReason(error: GitError): string {
  const line = error.stderr
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => /^(fatal|error):/i.test(text));
  return line ? line.replace(/^(fatal|error):\s*/i, '') : error.message;
}

/**
 * `git fetch origin <base>`, updating `origin/<base>` whatever the remote's fetch refspec says.
 * Resolves null once fetched, or the reason it could not be (no origin, offline, timed out, the base
 * is not on origin). Rejects only when git itself can't run or the call was aborted.
 */
export async function fetchBase(git: WorktreeGit, repo: string, base: string, call: CallOptions = {}): Promise<string | null> {
  const origin = await git.run(['config', '--get', 'remote.origin.url'], { cwd: repo, allowedExitCodes: [1], ...call });
  if (origin.exitCode !== 0 || origin.stdout.trim() === '') return 'This repo has no origin remote.';
  try {
    await git.run(
      ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', 'origin', '--end-of-options', `+${HEADS}${base}:${ORIGIN}${base}`],
      { cwd: repo, ...call },
    );
    return null;
  } catch (error) {
    if (!isGitError(error) || !(FETCH_FALLBACK_ERRORS as readonly string[]).includes(error.code)) throw error;
    if (error.code === 'TIMEOUT') return `Fetching ${base} from origin timed out.`;
    return `Could not fetch ${base} from origin: ${gitReason(error)}`;
  }
}

/** Where a ticket branch starts. */
export interface WorktreeStart {
  /** `origin/main` after a fetch, or `main` when origin could not be reached (the ticket says "local base when offline"). */
  ref: string;
  /** The commit the branch is created at. */
  commit: string;
  /** Null when the fetch worked; otherwise why the ticket started from a local ref. */
  fetchError: string | null;
}

async function commitOf(git: WorktreeGit, repo: string, ref: string, call: CallOptions): Promise<string | null> {
  const { stdout, exitCode } = await git.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: repo,
    allowedExitCodes: [1],
    ...call,
  });
  const commit = stdout.trim();
  return exitCode === 0 && commit !== '' ? commit : null;
}

/**
 * The commit to branch from: `origin/<base>` when the fetch worked, else the local `<base>`, else a
 * stale `origin/<base>` from an earlier fetch. Null when the base exists nowhere.
 */
export async function resolveStart(
  git: WorktreeGit,
  repo: string,
  base: string,
  fetchError: string | null,
  call: CallOptions = {},
): Promise<WorktreeStart | null> {
  const candidates = fetchError === null ? [`${ORIGIN}${base}`] : [`${HEADS}${base}`, `${ORIGIN}${base}`];
  for (const ref of candidates) {
    const commit = await commitOf(git, repo, ref, call);
    if (commit) return { ref: ref.startsWith(HEADS) ? base : `origin/${base}`, commit, fetchError };
  }
  return null;
}

/**
 * `git worktree add --no-track -b <branch> <path> <commit>`. The new branch has no upstream: the
 * ticket branch is pushed under its own name later, and tracking `origin/main` would make a plain
 * `git push` refuse.
 */
export async function addWorktree(
  git: WorktreeGit,
  repo: string,
  target: { path: string; branch: string; commit: string },
  call: CallOptions = {},
): Promise<void> {
  await git.run(['worktree', 'add', '--no-track', '-b', target.branch, '--end-of-options', target.path, target.commit], {
    cwd: repo,
    ...call,
  });
}

/** Whether git lists a worktree at `path` (its folder may be missing). */
export async function findRegisteredWorktree(git: WorktreeGit, repo: string, path: string, call: CallOptions = {}) {
  return (await git.worktrees(repo, call)).find((entry) => isSameRepoPath(entry.path, path));
}

/** What is at a worktree path before anything is created there. */
export type PathState = 'missing' | 'empty' | 'occupied';

export async function inspectPath(path: string): Promise<PathState> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory()) return 'occupied';
    return (await readdir(path)).length === 0 ? 'empty' : 'occupied';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------

export interface RollbackReport {
  /** True when nothing this attempt created is left: no worktree, folder or branch. */
  complete: boolean;
  /** What could not be removed, e.g. `worktree C:\src\.agent-lanes\71273` or `branch 71273-cutover`. */
  leftovers: string[];
}

export interface UndoAddOptions {
  repo: string;
  path: string;
  branch: string;
  /** The commit the branch was created at. The branch is only deleted while it still points there. */
  commit: string;
  /** The worktree folder before the attempt: missing, or an empty folder that is put back. */
  pathBefore: 'missing' | 'empty';
  /** The worktree root, and whether it existed before; a root this attempt created is removed when empty. */
  root: string;
  rootBefore: boolean;
  /** Waits between attempts to remove a worktree Windows still has files open in (antivirus, indexer). */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [250, 1_000];

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A folder that only git could have made: its `.git` file points into this repo's worktrees folder.
 * Anything else at the path is left alone, so a rollback never deletes someone else's files.
 */
export async function isWorktreeFolderOf(git: WorktreeGit, repo: string, path: string): Promise<boolean> {
  let pointer: string;
  try {
    pointer = await readFile(join(path, '.git'), 'utf8');
  } catch {
    return false;
  }
  const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)?.[1];
  if (!gitDir) return false;
  const { stdout } = await git.run(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo });
  const commonDir = stdout.trim();
  const target = isAbsolute(gitDir) ? gitDir : resolve(path, gitDir);
  return commonDir !== '' && isInsidePath(target, join(commonDir, 'worktrees'));
}

async function attempt(task: () => Promise<unknown>): Promise<boolean> {
  try {
    await task();
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes what a failed `git worktree add` (or a launch that failed after it) left behind: the
 * worktree, its folder, the new branch and a worktree root the attempt created. Never throws; what
 * it could not remove is listed in the report.
 *
 * Runs without the caller's abort signal: once started, a rollback finishes.
 */
export async function undoWorktreeAdd(git: WorktreeGit, options: UndoAddOptions): Promise<RollbackReport> {
  const { repo, path, branch } = options;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const leftovers: string[] = [];
  /** Unknown (git failed to answer) counts as still there. */
  const isRegistered = () => findRegisteredWorktree(git, repo, path).then((entry) => entry !== undefined, () => true);
  const removeWorktree = () => attempt(() => git.run(['worktree', 'remove', '--force', '--force', path], { cwd: repo }));
  const isOurFolder = () => isWorktreeFolderOf(git, repo, path).catch(() => false);
  const stateOf = () => inspectPath(path).catch((): PathState => 'occupied');

  // 1. The worktree. `worktree remove` deletes its folder and git's record of it; Windows may hold a
  //    freshly checked-out file open for a moment (antivirus, indexer), so it is tried again.
  let registered = await isRegistered();
  for (let i = 0; registered && i <= delays.length; i++) {
    if (i > 0) await sleep(delays[i - 1] ?? 0);
    registered = !(await removeWorktree()) && (await isRegistered());
  }
  if (registered && (await isOurFolder()) && (await attempt(() => rmTree(path)))) {
    // With the folder gone, `worktree remove` only has to drop git's record of it.
    registered = !(await removeWorktree()) && (await isRegistered());
  }
  if (registered) leftovers.push(`worktree ${path}`);

  // 2. The folder, when git was stopped before it could clean up after itself (a killed or timed-out add).
  if (!registered && (await stateOf()) === 'occupied' && (await isOurFolder()) && !(await attempt(() => rmTree(path)))) {
    leftovers.push(`folder ${path}`);
  }
  if (options.pathBefore === 'empty') await mkdir(path, { recursive: true }).catch(() => undefined);
  else if ((await stateOf()) === 'empty') await rmdir(path).catch(() => undefined);

  // 3. The branch. Git creates it before it looks at the folder, so it exists even when the add failed
  //    straight away. It is deleted only while no worktree has it checked out and it is still at `commit`.
  const ref = `${HEADS}${branch}`;
  const branchExists = await commitOf(git, repo, ref, {}).then((commit) => commit !== null, () => true);
  if (branchExists) {
    const checkedOut = await git.worktrees(repo).then((list) => list.some((entry) => entry.branchRef === ref), () => true);
    const deleted = !checkedOut && (await attempt(() => git.run(['update-ref', '-d', ref, options.commit], { cwd: repo })));
    if (!deleted) leftovers.push(`branch ${branch}`);
  }

  // 4. The worktree root, only if this attempt created it and nothing else is in it.
  if (!options.rootBefore) await rmdir(options.root).catch(() => undefined);

  return { complete: leftovers.length === 0, leftovers };
}

async function rmTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
