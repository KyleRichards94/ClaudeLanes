import { normalize } from 'node:path';
import { DEFAULT_BASE_BRANCH, type RepoFolderProblem } from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { GitService } from '../git/git-service';
import { isSameRepoPath } from './repo-paths';

/** The git calls the registry needs; tests pass a service built on an isolated runner. */
export type RepoGit = Pick<GitService, 'run' | 'worktrees' | 'ensureSupported'>;

export type FolderInspection =
  | {
      ok: true;
      /** The repo's main checkout: the folder itself, its work tree root, or the main worktree of a linked one. */
      path: string;
    }
  | {
      ok: false;
      problem: RepoFolderProblem;
      /** Git's own explanation, for `unreadable`. */
      gitMessage?: string;
    };

/** Failures that say something about the picked folder rather than about git or the machine. */
const FOLDER_ERRORS = ['COMMAND_FAILED', 'CWD_NOT_FOUND', 'TIMEOUT'] as const;

/**
 * Checks that a picked folder is inside a git work tree and finds the repo's main checkout (AL-081).
 * A sub-folder resolves to its work tree root and a linked worktree to the main checkout, so one repo
 * is registered once whichever of its folders is picked.
 *
 * Problems with the folder come back as `{ ok: false }`; a GitError about git itself (not installed,
 * could not start) is thrown for the caller to report.
 */
export async function inspectRepoFolder(git: RepoGit, folder: string): Promise<FolderInspection> {
  try {
    const flags = await revParse(git, folder, ['--is-inside-work-tree', '--is-bare-repository', '--is-inside-git-dir']);
    const [insideWorkTree, bare, insideGitDir] = flags.map((flag) => flag === 'true');
    if (bare) return { ok: false, problem: 'bare-repo' };
    if (insideGitDir) return { ok: false, problem: 'git-dir' };
    if (!insideWorkTree) return { ok: false, problem: 'not-a-repo' };

    const [topLevel = '', gitDir = '', commonDir = ''] = await revParse(git, folder, [
      '--path-format=absolute',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ]);
    if (!topLevel || !gitDir || !commonDir) {
      return { ok: false, problem: 'unreadable', gitMessage: 'Git did not say where this repository is.' };
    }
    // The main checkout, or a submodule, owns its git dir; a linked worktree shares the main one's.
    if (isSameRepoPath(gitDir, commonDir)) return { ok: true, path: normalize(topLevel) };

    const [main] = await git.worktrees(folder);
    if (!main || main.bare) return { ok: false, problem: 'bare-main' };
    return { ok: true, path: main.path };
  } catch (error) {
    if (isGitError(error, 'NOT_A_REPO')) return { ok: false, problem: 'not-a-repo' };
    if (isGitError(error) && (FOLDER_ERRORS as readonly string[]).includes(error.code)) {
      return { ok: false, problem: 'unreadable', gitMessage: error.stderr || error.message };
    }
    throw error;
  }
}

async function revParse(git: RepoGit, cwd: string, args: readonly string[]): Promise<string[]> {
  const { stdout } = await git.run(['rev-parse', ...args], { cwd });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const ORIGIN_PREFIX = 'refs/remotes/origin/';
/** Checked, in order, when the repo has no `origin/HEAD`. */
const FALLBACK_BRANCHES = ['main', 'master'] as const;

/**
 * The branch tickets start from and merge back into (design §9, Q2): the branch `origin/HEAD` points
 * at, which `git clone` records. Without it, `main` if the repo has one (locally or on origin), else
 * `master`, else `main`. Never contacts the remote.
 */
export async function detectBaseBranch(git: RepoGit, cwd: string): Promise<string> {
  try {
    // --quiet: exit 1 without a message when origin/HEAD is missing or not a symbolic ref.
    const head = await git.run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd, allowedExitCodes: [1] });
    const target = head.stdout.trim();
    if (head.exitCode === 0 && target.startsWith(ORIGIN_PREFIX) && target.length > ORIGIN_PREFIX.length) {
      return target.slice(ORIGIN_PREFIX.length);
    }

    const candidates = FALLBACK_BRANCHES.flatMap((branch) => [`refs/heads/${branch}`, `${ORIGIN_PREFIX}${branch}`]);
    const refs = await git.run(['for-each-ref', '--format=%(refname)', ...candidates], { cwd });
    const existing = new Set(refs.stdout.split(/\r?\n/).map((line) => line.trim()));
    const found = FALLBACK_BRANCHES.find(
      (branch) => existing.has(`refs/heads/${branch}`) || existing.has(`${ORIGIN_PREFIX}${branch}`),
    );
    return found ?? DEFAULT_BASE_BRANCH;
  } catch (error) {
    // Not knowing the default branch is no reason to refuse the repo; the user can change it (AL-146).
    if (isGitError(error, 'COMMAND_FAILED')) return DEFAULT_BASE_BRANCH;
    throw error;
  }
}
