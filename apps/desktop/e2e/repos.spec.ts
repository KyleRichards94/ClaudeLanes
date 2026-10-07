import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { AddRepoResponse, RemoveRepoResponse, RepoSettings, Result, Settings } from '@agent-lanes/contracts';

/**
 * Repo registry and folder picker (AL-081) against the real app, real git and a throwaway profile.
 * Playwright cannot click native dialogs, so the test replaces Electron's `dialog.showOpenDialog` and
 * `dialog.showMessageBox` in the main process: each returns a scripted answer and records how it was
 * called. Everything between the dialogs (git checks, settings, IPC) is the app's own code.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

interface DialogCall {
  /** Whether the dialog was given a parent window (modal to the app). */
  parented: boolean;
  options: Record<string, unknown>;
}

interface DialogLog {
  open: DialogCall[];
  box: DialogCall[];
}

let root: string;
let userDataDir: string;
let app: ElectronApplication | undefined;

/** git with this machine's identity and config kept out, so the fixture is the same everywhere. */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      GIT_AUTHOR_NAME: 'Agent Lanes Test',
      GIT_AUTHOR_EMAIL: 'test@agent-lanes.invalid',
      GIT_COMMITTER_NAME: 'Agent Lanes Test',
      GIT_COMMITTER_EMAIL: 'test@agent-lanes.invalid',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

/** A clone-like repo whose origin/HEAD points at `develop`, as `git clone` of such a remote records. */
function createRepo(): string {
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(['init', '--quiet', '--bare', '--initial-branch=main', origin], root);
  git(['init', '--quiet', '--initial-branch=main', work], root);
  writeFileSync(join(work, 'README.md'), '# fixture\n');
  git(['add', '--all'], work);
  git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial commit'], work);
  git(['remote', 'add', 'origin', origin], work);
  git(['push', '--quiet', 'origin', 'main', 'main:develop'], work);
  git(['remote', 'set-head', 'origin', 'develop'], work);
  mkdirSync(join(work, 'src'));
  return work;
}

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  return page;
}

/**
 * Scripts the native dialogs: the folder picker returns `folders` in turn (null = Cancel); each message
 * box answers with the next button index in `buttons` (1 = Cancel once they run out).
 */
async function scriptDialogs(running: ElectronApplication, folders: Array<string | null>, buttons: number[] = []): Promise<void> {
  await running.evaluate(
    ({ dialog }, script) => {
      const log: DialogLog = { open: [], box: [] };
      (globalThis as Record<string, unknown>)['__repoDialogLog'] = log;
      const record = (calls: DialogCall[], args: unknown[]) =>
        calls.push({ parented: args.length > 1, options: { ...(args.at(-1) as Record<string, unknown>) } });

      dialog.showOpenDialog = (async (...args: unknown[]) => {
        record(log.open, args);
        const folder = script.folders.shift() ?? null;
        return folder === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [folder] };
      }) as typeof dialog.showOpenDialog;

      dialog.showMessageBox = (async (...args: unknown[]) => {
        record(log.box, args);
        return { response: script.buttons.shift() ?? 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    },
    { folders, buttons },
  );
}

function dialogLog(running: ElectronApplication): Promise<DialogLog> {
  return running.evaluate(() => (globalThis as Record<string, unknown>)['__repoDialogLog'] as DialogLog);
}

function invoke<T>(page: Page, channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

async function data<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`${settled.code}: ${settled.message}`);
  return settled.data;
}

/** Repos in the settings file the app wrote, or [] when it has written none. */
function storedRepos(): RepoSettings[] {
  const file = join(userDataDir, 'settings.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as Settings).repos;
}

test.beforeEach(() => {
  // Long-form path: git prints C:\Users\Kyle.Richards where tmpdir() may say C:\Users\KYLE~1.RIC.
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-repos-')));
  writeFileSync(join(root, 'gitconfig'), '[core]\n\tautocrlf = false\n');
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-repos-profile-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(userDataDir, { recursive: true, force: true });
});

test('picking a non-git folder shows an error and stores nothing', async () => {
  const downloads = join(root, 'Downloads');
  mkdirSync(downloads);
  const page = await launch();
  const running = app!;

  // Closing the picker is not an error.
  await scriptDialogs(running, [null]);
  expect(await data(invoke<AddRepoResponse>(page, 'repos:add'))).toEqual({ status: 'cancelled', repos: [] });
  expect((await dialogLog(running)).box).toEqual([]);

  // A folder outside any repository: the error box opens over the window, the user cancels.
  await scriptDialogs(running, [downloads], [1]);
  expect(await data(invoke<AddRepoResponse>(page, 'repos:add'))).toEqual({
    status: 'rejected',
    reason: 'not-a-repo',
    folder: downloads,
    repos: [],
  });

  const log = await dialogLog(running);
  expect(log.open).toHaveLength(1);
  expect(log.open[0]).toMatchObject({ parented: true, options: { properties: expect.arrayContaining(['openDirectory']) } });
  expect(log.box).toHaveLength(1);
  expect(log.box[0]).toMatchObject({
    parented: true,
    options: {
      type: 'error',
      title: 'Not a git repository',
      message: '"Downloads" is not a git repository.',
      buttons: ['Choose another folder…', 'Cancel'],
    },
  });
  expect(String(log.box[0]?.options['detail'])).toContain(downloads);

  expect(await data(invoke<RepoSettings[]>(page, 'repos:list'))).toEqual([]);
  expect(storedRepos()).toEqual([]);
});

test('a git folder is registered with its default branch, once, and can be removed', async () => {
  const downloads = join(root, 'Downloads');
  mkdirSync(downloads);
  const work = createRepo();
  const page = await launch();
  const running = app!;

  // Wrong folder first; "Choose another folder…" reopens the picker there, then the repo is picked.
  await scriptDialogs(running, [downloads, work], [0]);
  const added = await data(invoke<AddRepoResponse>(page, 'repos:add'));

  const expected: RepoSettings = {
    path: work,
    name: 'work',
    baseBranch: 'develop',
    worktreeRoot: join(root, '.agent-lanes'),
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: 3,
  };
  expect(added).toEqual({ status: 'added', repo: expected, repos: [expected] });
  const log = await dialogLog(running);
  expect(log.box).toHaveLength(1);
  expect(log.open.map((call) => call.options['defaultPath'])).toEqual([undefined, downloads]);
  expect(storedRepos()).toEqual([expected]);

  // A folder inside the same repo finds the registered one; nothing is written twice.
  await scriptDialogs(running, [join(work, 'src')]);
  expect(await data(invoke<AddRepoResponse>(page, 'repos:add'))).toEqual({ status: 'existing', repo: expected, repos: [expected] });
  // The picker now opens next to the registered repo.
  expect((await dialogLog(running)).open[0]?.options['defaultPath']).toBe(root);
  expect(await data(invoke<RepoSettings[]>(page, 'repos:list'))).toEqual([expected]);

  expect(await data(invoke<RemoveRepoResponse>(page, 'repos:remove', { path: work }))).toEqual({ removed: true, repos: [] });
  expect(await data(invoke<RepoSettings[]>(page, 'repos:list'))).toEqual([]);
  expect(storedRepos()).toEqual([]);
  // The repo itself is untouched.
  expect(existsSync(join(work, '.git'))).toBe(true);
});
