import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from '../git/git-error';
import type { GitRunner } from '../git/git-runner';
import { createGitService, type GitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { detectBaseBranch, inspectRepoFolder } from './inspect-folder';

// Every git call is a process spawn (slow on Windows with antivirus), so these tests get more time.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;
let git: GitService;

beforeEach(async () => {
  repo = await createTempRepo();
  git = createGitService({ runner: repo.git });
});

afterEach(async () => {
  await repo?.cleanup();
});

/** A runner that fails every call with the given error. */
function failingGit(error: GitError): GitService {
  const runner: GitRunner = async () => {
    throw error;
  };
  return createGitService({ runner });
}

describe('inspectRepoFolder', () => {
  it('accepts the root of a work tree and returns it as the main checkout', async () => {
    await expect(inspectRepoFolder(git, repo.dir)).resolves.toEqual({ ok: true, path: repo.dir });
  });

  it('resolves a sub-folder to the root of its work tree', async () => {
    const nested = join(repo.dir, 'src', 'Web');
    await mkdir(nested, { recursive: true });
    await expect(inspectRepoFolder(git, nested)).resolves.toEqual({ ok: true, path: repo.dir });
  });

  it('resolves a linked worktree, or a folder inside one, to the main checkout', async () => {
    const linked = join(repo.root, '.agent-lanes', '71273');
    await repo.exec(['worktree', 'add', '--quiet', '-b', '71273-cutover', linked]);
    await mkdir(join(linked, 'docs'));

    await expect(inspectRepoFolder(git, linked)).resolves.toEqual({ ok: true, path: repo.dir });
    await expect(inspectRepoFolder(git, join(linked, 'docs'))).resolves.toEqual({ ok: true, path: repo.dir });
  });

  it('refuses a folder that is not in a git repository', async () => {
    const plain = join(repo.root, 'plain-folder');
    await mkdir(plain);
    await expect(inspectRepoFolder(git, plain)).resolves.toEqual({ ok: false, problem: 'not-a-repo' });
  });

  it('refuses a bare repository', async () => {
    await expect(inspectRepoFolder(git, repo.origin)).resolves.toEqual({ ok: false, problem: 'bare-repo' });
  });

  it("refuses a folder inside a repository's .git folder", async () => {
    await expect(inspectRepoFolder(git, join(repo.dir, '.git'))).resolves.toEqual({ ok: false, problem: 'git-dir' });
    await expect(inspectRepoFolder(git, join(repo.dir, '.git', 'refs'))).resolves.toEqual({ ok: false, problem: 'git-dir' });
  });

  it('refuses a linked worktree of a bare repository, which has no main checkout', async () => {
    const linked = join(repo.root, 'bare-worktree');
    await repo.exec(['--git-dir', repo.origin, 'worktree', 'add', '--quiet', linked, repo.branch], repo.root);
    await expect(inspectRepoFolder(git, linked)).resolves.toEqual({ ok: false, problem: 'bare-main' });
  });

  it("reports a folder git cannot read with git's own message", async () => {
    const dubious = new GitError('COMMAND_FAILED', 'git rev-parse failed (exit 128)', {
      exitCode: 128,
      stderr: "fatal: detected dubious ownership in repository at 'D:/share/osc'",
    });
    await expect(inspectRepoFolder(failingGit(dubious), repo.dir)).resolves.toEqual({
      ok: false,
      problem: 'unreadable',
      gitMessage: "fatal: detected dubious ownership in repository at 'D:/share/osc'",
    });
  });

  it('throws when git itself is the problem, for the caller to report', async () => {
    const missing = new GitError('GIT_NOT_FOUND', 'Git was not found');
    await expect(inspectRepoFolder(failingGit(missing), repo.dir)).rejects.toMatchObject({ code: 'GIT_NOT_FOUND' });
  });
});

describe('detectBaseBranch', () => {
  it('follows origin/HEAD', async () => {
    await repo.exec(['push', '--quiet', 'origin', `${repo.branch}:develop`]);
    await repo.exec(['remote', 'set-head', 'origin', 'develop']);
    await expect(detectBaseBranch(git, repo.dir)).resolves.toBe('develop');
  });

  it('follows origin/HEAD to a branch name with slashes', async () => {
    await repo.exec(['push', '--quiet', 'origin', `${repo.branch}:release/2026.10`]);
    await repo.exec(['remote', 'set-head', 'origin', 'release/2026.10']);
    await expect(detectBaseBranch(git, repo.dir)).resolves.toBe('release/2026.10');
  });

  it('falls back to main when origin/HEAD is not set', async () => {
    // createTempRepo adds origin with `git remote add`, which records no origin/HEAD.
    await expect(repo.exec(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])).rejects.toThrow();
    await expect(detectBaseBranch(git, repo.dir)).resolves.toBe('main');
  });

  it('falls back to master when the repo has no main', async () => {
    const legacy = await createTempRepo({ branch: 'master', withOrigin: false });
    try {
      await expect(detectBaseBranch(createGitService({ runner: legacy.git }), legacy.dir)).resolves.toBe('master');
    } finally {
      await legacy.cleanup();
    }
  });

  it('falls back to main when the repo has neither main nor master', async () => {
    const trunk = await createTempRepo({ branch: 'trunk' });
    try {
      await expect(detectBaseBranch(createGitService({ runner: trunk.git }), trunk.dir)).resolves.toBe('main');
    } finally {
      await trunk.cleanup();
    }
  });

  it('prefers main over master when both exist', async () => {
    await repo.exec(['branch', 'master']);
    await expect(detectBaseBranch(git, repo.dir)).resolves.toBe('main');
  });
});
