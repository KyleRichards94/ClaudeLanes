import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from './git-error';
import type { GitRunner } from './git-runner';
import { createGitService, type GitService } from './git-service';
import { MIN_GIT_VERSION, compareGitVersions } from './git-version';
import { hasConflicts, isCleanStatus } from './porcelain';
import { createTempRepo, type TempRepo } from './testing';

// Every git call is a process spawn (slow on Windows with antivirus), so these tests get more time.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;
let git: GitService;

/** A fresh temp repo (with origin) for each test in the calling describe block. */
function withTempRepo(): void {
  beforeEach(async () => {
    repo = await createTempRepo();
    git = createGitService({ runner: repo.git });
  });
  afterEach(async () => {
    await repo?.cleanup();
  });
}

function fakeRunner(stdout: string): GitRunner {
  return async () => ({ stdout, stderr: '', exitCode: 0 });
}

/** Windows file names cannot contain `"`; everywhere else the test keeps them. Single quotes and spaces stay. */
function fsName(name: string): string {
  return process.platform === 'win32' ? name.replaceAll('"', '') : name;
}

describe('version check', () => {
  it('accepts the installed git (the machine running the tests has 2.38 or later)', async () => {
    const installed = createGitService();
    const check = await installed.checkVersion();
    expect(check.ok).toBe(true);
    if (check.ok) expect(compareGitVersions(check.version, MIN_GIT_VERSION)).toBeGreaterThanOrEqual(0);
    await expect(installed.ensureSupported()).resolves.toMatchObject({ major: expect.any(Number) });
  });

  it('explains a too-old git: what is needed, what was found and what to do', async () => {
    const old = createGitService({ runner: fakeRunner('git version 2.37.9.windows.1\n') });
    const check = await old.checkVersion();
    expect(check).toEqual({
      ok: false,
      reason: 'too-old',
      version: { major: 2, minor: 37, patch: 9 },
      message:
        'Agent Lanes needs Git 2.38 or later, and this computer has Git 2.37.9. Install the latest Git from https://git-scm.com/downloads, then restart Agent Lanes.',
    });
    await expect(old.ensureSupported()).rejects.toMatchObject({ name: 'GitError', code: 'GIT_TOO_OLD', message: check.ok ? '' : check.message });
  });

  it('explains a missing git, from a real lookup of an executable that does not exist', async () => {
    const missing = createGitService({ gitPath: 'agent-lanes-no-such-git-binary' });
    const check = await missing.checkVersion();
    expect(check).toMatchObject({ ok: false, reason: 'not-found', version: null });
    expect(check.ok ? '' : check.message).toBe(
      'Agent Lanes needs Git 2.38 or later, and Git was not found on this computer. Install the latest Git from https://git-scm.com/downloads, then restart Agent Lanes.',
    );
    await expect(missing.ensureSupported()).rejects.toMatchObject({ code: 'GIT_NOT_FOUND' });
  });

  it('reports output it cannot read as an unknown version', async () => {
    const odd = createGitService({ runner: fakeRunner('something else entirely') });
    const check = await odd.checkVersion();
    expect(check).toMatchObject({ ok: false, reason: 'unknown', version: null });
    expect(check.ok ? '' : check.message).toContain('could not be checked');
    await expect(odd.version()).rejects.toMatchObject({ code: 'PARSE_FAILED' });
  });
});

describe('status', () => {
  withTempRepo();

  it('reads a clean checkout tracking origin', async () => {
    const status = await git.status(repo.dir);
    expect(status.branch).toEqual({
      oid: await repo.exec(['rev-parse', 'HEAD']),
      head: 'main',
      detached: false,
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
    });
    expect(status.entries).toEqual([]);
    expect(isCleanStatus(status)).toBe(true);
  });

  it('reads modified, staged, renamed and untracked paths with spaces and quotes', async () => {
    await repo.write('old name.txt', 'same content\n');
    await repo.commit('add file');
    const renamed = fsName(`new "name" 'x'.txt`);
    const untracked = fsName(`untracked "q" 'x'.md`);
    await repo.exec(['mv', 'old name.txt', renamed]);
    await repo.write('README.md', '# modified\n');
    await repo.write(untracked, 'new\n');
    await repo.write('staged.txt', 'staged\n');
    await repo.exec(['add', 'staged.txt']);

    const status = await git.status(repo.dir);

    expect(status.branch).toMatchObject({ head: 'main', ahead: 1, behind: 0 });
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'changed', index: '.', worktree: 'M', path: 'README.md' }),
        expect.objectContaining({ kind: 'changed', index: 'A', worktree: '.', path: 'staged.txt' }),
        expect.objectContaining({ kind: 'renamed', score: 100, path: renamed, originalPath: 'old name.txt' }),
        { kind: 'untracked', path: untracked },
      ]),
    );
    expect(status.entries).toHaveLength(4);
    expect(isCleanStatus(status)).toBe(false);
  });

  it('reads a merge conflict as unmerged', async () => {
    await repo.exec(['switch', '--quiet', '-c', 'other']);
    await repo.write('README.md', '# other\n');
    await repo.commit('other change');
    await repo.exec(['switch', '--quiet', 'main']);
    await repo.write('README.md', '# main\n');
    await repo.commit('main change');
    await repo.git(['merge', '--no-edit', 'other'], { cwd: repo.dir, allowedExitCodes: [1] });

    const status = await git.status(repo.dir);
    expect(hasConflicts(status)).toBe(true);
    expect(status.entries).toEqual([
      { kind: 'unmerged', index: 'U', worktree: 'U', submodule: 'N...', path: 'README.md' },
    ]);
  });

  it('lists ignored files only when asked', async () => {
    await repo.write('.gitignore', 'bin/\n');
    await repo.commit('ignore bin');
    await repo.write('bin/out.dll', 'x');

    expect((await git.status(repo.dir)).entries).toEqual([]);
    const withIgnored = await git.status(repo.dir, { ignored: true });
    expect(withIgnored.entries).toEqual([{ kind: 'ignored', path: 'bin/' }]);
    expect(isCleanStatus(withIgnored)).toBe(true);
  });

  it('fails with NOT_A_REPO outside a repository', async () => {
    await expect(git.status(repo.root)).rejects.toMatchObject({ code: 'NOT_A_REPO' });
  });
});

describe('worktrees', () => {
  withTempRepo();

  it('lists the main checkout and added worktrees, with paths and branch names containing spaces and quotes', async () => {
    const ticketPath = join(repo.root, '.agent-lanes', fsName(`71273 it's "fine"`));
    // Loose refs are files too, so the same Windows limit applies to branch names.
    const ticketBranch = fsName(`71273-it's-"fine"`);
    const detachedPath = join(repo.root, '.agent-lanes', 'detached one');

    await repo.exec(['worktree', 'add', '--quiet', '-b', ticketBranch, ticketPath, 'main']);
    await repo.exec(['worktree', 'lock', '--reason', 'agent running', ticketPath]);
    await repo.exec(['worktree', 'add', '--quiet', '--detach', detachedPath, 'main']);

    const head = await repo.exec(['rev-parse', 'HEAD']);
    const list = await git.worktrees(repo.dir);

    expect(list).toEqual([
      expect.objectContaining({ path: normalize(repo.dir), head, branch: 'main', branchRef: 'refs/heads/main', locked: false }),
      expect.objectContaining({
        path: normalize(ticketPath),
        head,
        branch: ticketBranch,
        locked: true,
        lockedReason: 'agent running',
        detached: false,
      }),
      expect.objectContaining({ path: normalize(detachedPath), head, branch: null, detached: true }),
    ]);

    // The same list from inside a linked worktree.
    expect((await git.worktrees(ticketPath)).map((entry) => entry.path)).toEqual(list.map((entry) => entry.path));
  });
});

describe('aheadBehind', () => {
  withTempRepo();

  it('counts commits on each side of base...head', async () => {
    await repo.exec(['switch', '--quiet', '-c', fsName(`feature/it's-"ahead"`)]);
    const feature = await repo.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
    await repo.commit('feature 1');
    await repo.commit('feature 2');
    await repo.exec(['switch', '--quiet', 'main']);
    await repo.commit('main 1');

    expect(await git.aheadBehind(repo.dir, 'main', feature)).toEqual({ ahead: 2, behind: 1 });
    expect(await git.aheadBehind(repo.dir, feature, 'main')).toEqual({ ahead: 1, behind: 2 });
    expect(await git.aheadBehind(repo.dir, 'origin/main', 'main')).toEqual({ ahead: 1, behind: 0 });
  });

  it('never reads a revision as an option', async () => {
    const error = await git.aheadBehind(repo.dir, '--output=pwned.txt', 'main').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitError);
    expect(existsSync(join(repo.dir, 'pwned.txt'))).toBe(false);
    expect(existsSync(join(repo.dir, 'pwned.txt...main'))).toBe(false);

    await expect(git.aheadBehind(repo.dir, '', 'main')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
