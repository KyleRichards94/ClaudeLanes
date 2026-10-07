import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService, type GitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { fetchBase, inspectPath, listBranchNames, resolveStart, undoWorktreeAdd } from './worktree-git';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git.
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

describe('git steps', () => {
  it('lists local branches and origin branches without the prefix, but not origin/HEAD', async () => {
    await repo.exec(['branch', 'feature/a']);
    await repo.exec(['push', '--quiet', 'origin', 'HEAD:refs/heads/remote-only']);
    await repo.exec(['fetch', '--quiet', 'origin']);
    await repo.exec(['remote', 'set-head', 'origin', 'main']);
    expect((await listBranchNames(git, repo.dir)).sort()).toEqual(['feature/a', 'main', 'remote-only']);
  });

  it('fetches the base, or says why it could not', async () => {
    expect(await fetchBase(git, repo.dir, 'main')).toBeNull();
    expect(await fetchBase(git, repo.dir, 'no-such-branch')).toMatch(/^Could not fetch no-such-branch from origin: couldn't find remote ref/);
  });

  it('prefers origin/<base> after a fetch, and the local base when the fetch failed', async () => {
    const pushed = await repo.exec(['rev-parse', 'HEAD']);
    const local = await repo.commit('Local commit');
    expect(await resolveStart(git, repo.dir, 'main', null)).toEqual({ ref: 'origin/main', commit: pushed, fetchError: null });
    expect(await resolveStart(git, repo.dir, 'main', 'offline')).toEqual({ ref: 'main', commit: local, fetchError: 'offline' });
    expect(await resolveStart(git, repo.dir, 'nope', 'offline')).toBeNull();
  });

  it('tells a missing path, an empty folder and an occupied one apart', async () => {
    const dir = join(repo.root, 'probe');
    expect(await inspectPath(dir)).toBe('missing');
    await mkdir(dir);
    expect(await inspectPath(dir)).toBe('empty');
    await writeFile(join(dir, 'file.txt'), 'x');
    expect(await inspectPath(dir)).toBe('occupied');
    expect(await inspectPath(join(dir, 'file.txt'))).toBe('occupied');
  });
});

describe('undoWorktreeAdd', () => {
  it("never deletes a folder git did not make, but still deletes the branch git created before refusing it", async () => {
    // Someone else's files appear at the path between the check and `git worktree add`.
    const root = join(repo.root, '.agent-lanes');
    const path = join(root, '71273');
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'notes.txt'), 'not ours');
    const commit = await repo.exec(['rev-parse', 'HEAD']);
    await expect(repo.exec(['worktree', 'add', '-b', '71273-cutover', path, commit])).rejects.toThrow(/already exists/);
    expect(await repo.exec(['branch', '--list', '71273-cutover'])).toContain('71273-cutover');

    const report = await undoWorktreeAdd(git, { repo: repo.dir, path, branch: '71273-cutover', commit, pathBefore: 'missing', root, rootBefore: false, retryDelaysMs: [] });

    expect(report).toEqual({ complete: true, leftovers: [] });
    expect(await readFile(join(path, 'notes.txt'), 'utf8')).toBe('not ours');
    expect(await repo.exec(['branch', '--list', '71273-cutover'])).toBe('');
    expect(existsSync(root)).toBe(true);
  });

  it('keeps a branch that has moved on from the commit it was created at', async () => {
    const root = join(repo.root, '.agent-lanes');
    const commit = await repo.exec(['rev-parse', 'HEAD']);
    await repo.exec(['branch', 'moved', commit]);
    await repo.exec(['checkout', '--quiet', 'moved']);
    await repo.commit('Work on moved');
    await repo.exec(['checkout', '--quiet', 'main']);

    const report = await undoWorktreeAdd(git, {
      repo: repo.dir,
      path: join(root, 'x'),
      branch: 'moved',
      commit,
      pathBefore: 'missing',
      root,
      rootBefore: false,
      retryDelaysMs: [],
    });

    expect(report).toEqual({ complete: false, leftovers: ['branch moved'] });
    expect(await repo.exec(['branch', '--list', 'moved'])).toContain('moved');
  });
});
