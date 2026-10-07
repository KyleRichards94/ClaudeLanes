import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createGitRunner, type GitRunner } from '../git-runner';

/**
 * Temp git repositories for main-process tests (the smallest piece of the AL-221 kit, built for
 * AL-080). Git runs isolated from the developer's machine: no system or global config, no hooks,
 * no signing, no credential helper, so tests behave the same on every computer and in CI.
 */

export interface TempRepo {
  /** Folder holding everything below; removed by `cleanup()`. */
  root: string;
  /** The working clone (default branch checked out). */
  dir: string;
  /** Bare repository registered as `origin` in `dir`. */
  origin: string;
  /** Default branch name. */
  branch: string;
  /** Runner with the isolated environment; use it (or `isolatedGitEnv`) for anything run against the repo. */
  git: GitRunner;
  /** `git(args)` in `dir` (or `cwd`), returning trimmed stdout. */
  exec(args: readonly string[], cwd?: string): Promise<string>;
  /** Writes a file relative to `dir` (or `cwd`), creating folders. */
  write(path: string, content: string, cwd?: string): Promise<string>;
  /** Stages everything and commits; returns the new commit id. */
  commit(message: string, cwd?: string): Promise<string>;
  cleanup(): Promise<void>;
}

export interface TempRepoOptions {
  /** Defaults to `main`. */
  branch?: string;
  /** Create a bare `origin` and push the first commit to it. Defaults to true. */
  withOrigin?: boolean;
  /**
   * Ref storage for the working clone. `reftable` (Git 2.45+) can hold branch names that Windows
   * filenames cannot (`"`, `|`, `<`, `>`); the default `files` matches most users' repositories.
   */
  refFormat?: 'files' | 'reftable';
}

/** Environment that makes git ignore the machine's config (needs Git 2.32+ for GIT_CONFIG_GLOBAL). */
export function isolatedGitEnv(root: string): Record<string, string> {
  return {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_CEILING_DIRECTORIES: root,
    GIT_AUTHOR_NAME: 'Agent Lanes Test',
    GIT_AUTHOR_EMAIL: 'test@agent-lanes.invalid',
    GIT_COMMITTER_NAME: 'Agent Lanes Test',
    GIT_COMMITTER_EMAIL: 'test@agent-lanes.invalid',
  };
}

const GLOBAL_CONFIG = `[core]
\tautocrlf = false
\thooksPath = no-hooks
[commit]
\tgpgsign = false
[tag]
\tgpgsign = false
[init]
\tdefaultBranch = main
[advice]
\tdetachedHead = false
`;

export async function createTempRepo(options: TempRepoOptions = {}): Promise<TempRepo> {
  const branch = options.branch ?? 'main';
  // realpath: on Windows tmpdir() may be an 8.3 short path (KYLE~1.RIC), which git prints in long form.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-lanes-git-')));
  await writeFile(join(root, 'gitconfig'), GLOBAL_CONFIG);

  const git = createGitRunner({ env: isolatedGitEnv(root), defaultTimeoutMs: 30_000 });
  const dir = join(root, 'work');
  const origin = join(root, 'origin.git');

  const exec = async (args: readonly string[], cwd = dir) => (await git(args, { cwd })).stdout.trim();
  const write = async (path: string, content: string, cwd = dir) => {
    const target = join(cwd, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
  };
  const commit = async (message: string, cwd = dir) => {
    await exec(['add', '--all'], cwd);
    await exec(['commit', '--quiet', '--allow-empty', '-m', message], cwd);
    return exec(['rev-parse', 'HEAD'], cwd);
  };

  await mkdir(dir);
  const refFormat = options.refFormat ? [`--ref-format=${options.refFormat}`] : [];
  await exec(['init', '--quiet', `--initial-branch=${branch}`, ...refFormat], dir);
  await write('README.md', '# temp repo\n');
  await commit('Initial commit');

  if (options.withOrigin ?? true) {
    await exec(['init', '--quiet', '--bare', `--initial-branch=${branch}`, origin], root);
    await exec(['remote', 'add', 'origin', origin]);
    await exec(['push', '--quiet', '-u', 'origin', branch]);
  }

  return {
    root,
    dir,
    origin,
    branch,
    git,
    exec,
    write,
    commit,
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}
