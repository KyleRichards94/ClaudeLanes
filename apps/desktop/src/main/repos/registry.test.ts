import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultSettings, type Settings } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService, type GitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createRepoSettings } from '../settings/repo-settings';
import { createSettingsService, type SettingsService } from '../settings/service';
import { createMemorySettingsFile, type MemorySettingsFile, type SettingsFile } from '../settings/settings-file';
import { createRepoRegistry, describeFolderProblem, type RepoDialogs, type RepoFolderNotice } from './registry';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

interface FakeDialogs extends RepoDialogs {
  /** Options of every folder picker opened, in order. */
  readonly picks: Array<{ defaultPath?: string }>;
  /** Every refused-folder notice shown, in order. */
  readonly problems: RepoFolderNotice[];
}

/**
 * Stand-in for the native dialogs: the folder picker returns `folders` in turn (null = Cancel), and
 * each refused-folder box answers with the next of `answers` (Cancel once they run out).
 */
function fakeDialogs(folders: Array<string | null>, answers: Array<'pick-again' | 'cancel'> = []): FakeDialogs {
  const picks: Array<{ defaultPath?: string }> = [];
  const problems: RepoFolderNotice[] = [];
  return {
    picks,
    problems,
    pickFolder: vi.fn(async (options: { defaultPath?: string }) => {
      picks.push(options);
      return folders.shift() ?? null;
    }),
    showProblem: vi.fn(async (notice: RepoFolderNotice) => {
      problems.push(notice);
      return answers.shift() ?? 'cancel';
    }),
  };
}

let repo: TempRepo;
let git: GitService;
let file: MemorySettingsFile;
let settings: SettingsService;

function seed(stored: Settings = defaultSettings()): void {
  file = createMemorySettingsFile(stored);
  settings = createSettingsService({ file, warn: vi.fn() });
}

function registry(dialogs: RepoDialogs, platform: NodeJS.Platform = process.platform) {
  return createRepoRegistry({ git, settings, dialogs, platform });
}

beforeEach(async () => {
  repo = await createTempRepo();
  git = createGitService({ runner: repo.git });
  seed();
});

afterEach(async () => {
  await repo?.cleanup();
});

describe('repos.add', () => {
  it('picking a non-git folder shows an error and stores nothing', async () => {
    const plain = join(repo.root, 'Downloads');
    await mkdir(plain);
    const dialogs = fakeDialogs([plain], ['cancel']);

    const result = await registry(dialogs).add();

    expect(result).toEqual({ ok: true, data: { status: 'rejected', reason: 'not-a-repo', folder: plain, repos: [] } });
    expect(dialogs.problems).toEqual([
      {
        problem: 'not-a-repo',
        folder: plain,
        title: 'Not a git repository',
        message: '"Downloads" is not a git repository.',
        detail: expect.stringContaining(plain),
      },
    ]);
    expect(dialogs.problems[0]?.detail).toContain('the one with the .git folder in it');
    expect(file.writes).toBe(0);
    expect(settings.get().repos).toEqual([]);
  });

  it('"Choose another folder…" reopens the picker in the refused folder, then registers the repo picked there', async () => {
    const parent = join(repo.root, 'projects');
    await mkdir(parent);
    const dialogs = fakeDialogs([parent, repo.dir], ['pick-again']);

    const result = await registry(dialogs).add();

    expect(dialogs.problems.map((notice) => notice.problem)).toEqual(['not-a-repo']);
    expect(dialogs.picks).toEqual([{ defaultPath: undefined }, { defaultPath: parent }]);
    expect(result.ok && result.data.status).toBe('added');
    expect(settings.get().repos.map((stored) => stored.path)).toEqual([repo.dir]);
  });

  it('registers a git work tree with its folder name, detected base branch and worktree root next to it', async () => {
    await repo.exec(['push', '--quiet', 'origin', `${repo.branch}:develop`]);
    await repo.exec(['remote', 'set-head', 'origin', 'develop']);
    const dialogs = fakeDialogs([repo.dir]);

    const result = await registry(dialogs).add();

    const expected = {
      path: repo.dir,
      name: 'work',
      baseBranch: 'develop',
      worktreeRoot: join(repo.root, '.agent-lanes'),
      buildCommand: null,
      runCommand: null,
      maxConcurrentAgents: 3,
    };
    expect(result).toEqual({ ok: true, data: { status: 'added', repo: expected, repos: [expected] } });
    expect(dialogs.problems).toEqual([]);
    expect(file.writes).toBe(1);
    expect(file.contents).toMatchObject({ repos: [expected] });
  });

  it('uses main as the base branch when origin/HEAD is not set', async () => {
    const result = await registry(fakeDialogs([repo.dir])).add();
    expect(result.ok && result.data.status === 'added' && result.data.repo.baseBranch).toBe('main');
  });

  it('registers the main checkout when a sub-folder or a linked worktree is picked, and only once', async () => {
    const nested = join(repo.dir, 'src');
    await mkdir(nested);
    const linked = join(repo.root, '.agent-lanes', '71273');
    await repo.exec(['worktree', 'add', '--quiet', '-b', '71273-cutover', linked]);
    const repos = registry(fakeDialogs([nested, linked, repo.dir]));

    const first = await repos.add();
    const second = await repos.add();
    const third = await repos.add();

    expect(first.ok && first.data.status === 'added' && first.data.repo.path).toBe(repo.dir);
    expect(second).toMatchObject({ ok: true, data: { status: 'existing', repo: { path: repo.dir } } });
    expect(third).toMatchObject({ ok: true, data: { status: 'existing', repo: { path: repo.dir } } });
    expect(settings.get().repos).toHaveLength(1);
    expect(file.writes).toBe(1);
  });

  it('treats a path differing only in case as the same repo on Windows', async () => {
    const stored = createRepoSettings(repo.dir.toUpperCase(), { name: 'osc' });
    seed({ ...defaultSettings(), repos: [stored] });

    const result = await registry(fakeDialogs([repo.dir]), 'win32').add();

    expect(result).toEqual({ ok: true, data: { status: 'existing', repo: stored, repos: [stored] } });
    expect(file.writes).toBe(0);
  });

  it('stores nothing when the picker is cancelled', async () => {
    const dialogs = fakeDialogs([null]);
    await expect(registry(dialogs).add()).resolves.toEqual({ ok: true, data: { status: 'cancelled', repos: [] } });
    expect(dialogs.problems).toEqual([]);
    expect(file.writes).toBe(0);
  });

  it('opens the picker next to the last registered repo', async () => {
    const elsewhere = createRepoSettings(join(repo.root, 'nested', 'other-repo'));
    seed({ ...defaultSettings(), repos: [elsewhere] });
    const dialogs = fakeDialogs([null]);

    await registry(dialogs).add();

    expect(dialogs.picks).toEqual([{ defaultPath: dirname(elsewhere.path) }]);
  });

  it('opens one picker at a time; a second call gets the same outcome', async () => {
    let choose: (folder: string | null) => void = () => undefined;
    const dialogs: RepoDialogs = {
      pickFolder: vi.fn(() => new Promise<string | null>((resolve) => (choose = resolve))),
      showProblem: vi.fn(async () => 'cancel' as const),
    };
    const repos = registry(dialogs);

    const first = repos.add();
    const second = repos.add();
    await vi.waitFor(() => expect(dialogs.pickFolder).toHaveBeenCalledTimes(1));
    choose(repo.dir);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.ok && a.data.status).toBe('added');
    expect(dialogs.pickFolder).toHaveBeenCalledTimes(1);

    // Once settled, the next call opens a new picker.
    const third = repos.add();
    await vi.waitFor(() => expect(dialogs.pickFolder).toHaveBeenCalledTimes(2));
    choose(null);
    await expect(third).resolves.toMatchObject({ ok: true, data: { status: 'cancelled' } });
  });

  it('reports a missing git before opening the picker', async () => {
    git = createGitService({ gitPath: 'agent-lanes-no-such-git-binary' });
    const dialogs = fakeDialogs([repo.dir]);

    const result = await registry(dialogs).add();

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { gitCode: 'GIT_NOT_FOUND' } });
    expect(!result.ok && result.message).toContain('Git was not found');
    expect(dialogs.pickFolder).not.toHaveBeenCalled();
  });

  it('returns the error and keeps the settings when they cannot be saved', async () => {
    const failing: SettingsFile = {
      location: 'memory://read-only.json',
      read: () => undefined,
      write: () => {
        throw new Error('disk full');
      },
    };
    settings = createSettingsService({ file: failing, warn: vi.fn() });

    const result = await registry(fakeDialogs([repo.dir])).add();

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(!result.ok && result.message).toContain('disk full');
    expect(settings.get().repos).toEqual([]);
  });
});

describe('repos.list and repos.remove', () => {
  const osc = createRepoSettings(join('C:', 'src', 'onsite-companion'));
  const lanes = createRepoSettings(join('C:', 'src', 'agent-lanes'));

  it('lists the registered repos in order', () => {
    seed({ ...defaultSettings(), repos: [osc, lanes] });
    expect(registry(fakeDialogs([])).list()).toEqual([osc, lanes]);
  });

  it('removes a repo by path and keeps the others', () => {
    seed({ ...defaultSettings(), repos: [osc, lanes] });

    const result = registry(fakeDialogs([])).remove(osc.path);

    expect(result).toEqual({ ok: true, data: { removed: true, repos: [lanes] } });
    expect(file.contents).toMatchObject({ repos: [lanes] });
  });

  it('matches the path without case on Windows', () => {
    seed({ ...defaultSettings(), repos: [osc, lanes] });
    const result = registry(fakeDialogs([]), 'win32').remove(lanes.path.toUpperCase());
    expect(result).toEqual({ ok: true, data: { removed: true, repos: [osc] } });
  });

  it('reports an unknown path as not removed and writes nothing', () => {
    seed({ ...defaultSettings(), repos: [osc] });
    const result = registry(fakeDialogs([])).remove(lanes.path);
    expect(result).toEqual({ ok: true, data: { removed: false, repos: [osc] } });
    expect(file.writes).toBe(0);
  });
});

describe('describeFolderProblem', () => {
  it('names the folder and says what to pick instead, for every problem', () => {
    const folder = join('C:', 'Users', 'kyle', 'Downloads');
    const problems = ['not-a-repo', 'bare-repo', 'git-dir', 'bare-main', 'unreadable'] as const;
    for (const problem of problems) {
      const notice = describeFolderProblem({ ok: false, problem }, folder);
      expect(notice.message).toContain('"Downloads"');
      expect(notice.detail.endsWith(folder)).toBe(true);
      expect(notice.title.length).toBeGreaterThan(0);
    }
  });

  it("shows git's own message for a folder git cannot read", () => {
    const notice = describeFolderProblem(
      { ok: false, problem: 'unreadable', gitMessage: "fatal: detected dubious ownership in repository at 'D:/osc'" },
      'D:\\osc',
    );
    expect(notice.detail).toContain('dubious ownership');
  });
});
