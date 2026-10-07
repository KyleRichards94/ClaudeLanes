import { basename, dirname } from 'node:path';
import {
  ok,
  type AddRepoResponse,
  type RemoveRepoResponse,
  type RepoFolderProblem,
  type RepoSettings,
  type Result,
} from '@agent-lanes/contracts';
import { gitErrorToErr } from '../git/git-error';
import { createRepoSettings } from '../settings/repo-settings';
import type { SettingsService } from '../settings/service';
import { detectBaseBranch, inspectRepoFolder, type FolderInspection, type RepoGit } from './inspect-folder';
import { isSameRepoPath } from './repo-paths';

/** What the user is told when a picked folder cannot be registered. */
export interface RepoFolderNotice {
  problem: RepoFolderProblem;
  /** The folder as the dialog returned it. */
  folder: string;
  /** Window title. */
  title: string;
  /** One line: what is wrong with the folder. */
  message: string;
  /** What to pick instead, and the full path. */
  detail: string;
}

/** Native dialogs in production (`electron-dialogs.ts`), fakes in tests. */
export interface RepoDialogs {
  /** The native folder picker. Resolves the chosen folder, or null when the user cancelled. */
  pickFolder(options: { defaultPath?: string }): Promise<string | null>;
  /** Shows why the folder was refused. Resolves `pick-again` when the user wants to choose another folder. */
  showProblem(notice: RepoFolderNotice): Promise<'pick-again' | 'cancel'>;
}

/**
 * The registered repos (AL-081, design §8, §9): stored in the settings document (AL-041), added only
 * through the native folder picker, so the renderer never sends a path to register (D65).
 */
export interface RepoRegistry {
  /** Registered repos, in the order they were added. */
  list(): RepoSettings[];
  /**
   * Opens the folder picker, checks the folder is in a git work tree, detects the default branch and
   * registers the repo. A folder that is not usable is explained in a native message box with
   * "Choose another folder…"; nothing is stored unless a usable folder is picked. Only one picker
   * opens at a time: a second call while one is open gets the same outcome.
   */
  add(): Promise<Result<AddRepoResponse>>;
  /** Forgets a registered repo. Its folder, worktrees and branches are left alone. */
  remove(path: string): Result<RemoveRepoResponse>;
}

export interface RepoRegistryOptions {
  git: RepoGit;
  settings: SettingsService;
  dialogs: RepoDialogs;
  /** Decides whether paths compare without case; defaults to this machine's. */
  platform?: NodeJS.Platform;
}

export function createRepoRegistry({ git, settings, dialogs, platform = process.platform }: RepoRegistryOptions): RepoRegistry {
  let picking: Promise<Result<AddRepoResponse>> | null = null;

  const repos = () => settings.get().repos;
  const find = (list: readonly RepoSettings[], path: string) => list.find((repo) => isSameRepoPath(repo.path, path, platform));

  async function register(path: string): Promise<Result<AddRepoResponse>> {
    const known = find(repos(), path);
    if (known) return ok({ status: 'existing', repo: known, repos: repos() });

    let baseBranch: string;
    try {
      baseBranch = await detectBaseBranch(git, path);
    } catch (error) {
      return gitErrorToErr(error);
    }

    // Read again after the await, and check and save in one synchronous step.
    const current = repos();
    const registered = find(current, path);
    if (registered) return ok({ status: 'existing', repo: registered, repos: current });

    const repo = createRepoSettings(path, { baseBranch });
    const saved = settings.update({ repos: [...current, repo] });
    if (!saved.ok) return saved;
    return ok({ status: 'added', repo: find(saved.data.repos, path) ?? repo, repos: saved.data.repos });
  }

  async function pickAndRegister(): Promise<Result<AddRepoResponse>> {
    // Fail before the dialog opens rather than after the user has picked a folder.
    try {
      await git.ensureSupported();
    } catch (error) {
      return gitErrorToErr(error);
    }

    // Repos usually sit side by side, so start next to the last one registered.
    const last = repos().at(-1);
    let defaultPath = last ? dirname(last.path) : undefined;

    for (;;) {
      const folder = await dialogs.pickFolder({ defaultPath });
      if (folder === null) return ok({ status: 'cancelled', repos: repos() });

      let inspection: FolderInspection;
      try {
        inspection = await inspectRepoFolder(git, folder);
      } catch (error) {
        return gitErrorToErr(error);
      }
      if (inspection.ok) return register(inspection.path);

      const choice = await dialogs.showProblem(describeFolderProblem(inspection, folder));
      if (choice === 'cancel') return ok({ status: 'rejected', reason: inspection.problem, folder, repos: repos() });
      // Open the picker again where the user was, so a parent folder can be drilled into.
      defaultPath = folder;
    }
  }

  return {
    list: repos,

    add() {
      picking ??= pickAndRegister().finally(() => {
        picking = null;
      });
      return picking;
    },

    remove(path) {
      const current = repos();
      const target = find(current, path);
      if (!target) return ok({ removed: false, repos: current });

      const saved = settings.update({ repos: current.filter((repo) => repo !== target) });
      if (!saved.ok) return saved;
      return ok({ removed: true, repos: saved.data.repos });
    },
  };
}

/** The copy for the native message box shown when a picked folder is refused. */
export function describeFolderProblem(inspection: Extract<FolderInspection, { ok: false }>, folder: string): RepoFolderNotice {
  const name = basename(folder) || folder;
  const notice = (title: string, message: string, advice: string): RepoFolderNotice => ({
    problem: inspection.problem,
    folder,
    title,
    message,
    detail: `${advice}\n\n${folder}`,
  });

  switch (inspection.problem) {
    case 'not-a-repo':
      return notice(
        'Not a git repository',
        `"${name}" is not a git repository.`,
        'Agent Lanes works on a git repository on this computer. Choose the folder of the repo itself (the one with the .git folder in it), or clone the repo first.',
      );
    case 'bare-repo':
      return notice(
        'Bare repository',
        `"${name}" is a bare repository.`,
        'A bare repository has no checked-out files to start ticket worktrees from. Choose the folder of a regular clone.',
      );
    case 'git-dir':
      return notice(
        'Inside a .git folder',
        `"${name}" is inside a repository's .git folder.`,
        'Choose the repository folder that contains .git, not a folder inside it.',
      );
    case 'bare-main':
      return notice(
        'Worktree of a bare repository',
        `"${name}" is a worktree of a bare repository.`,
        'Agent Lanes registers a repo by its main checkout, and this repository has none. Choose the folder of a regular clone.',
      );
    case 'unreadable':
      return notice(
        'Git could not read the folder',
        `Git could not read "${name}".`,
        inspection.gitMessage?.trim() || 'Check that the folder still exists and that you can open it.',
      );
  }
}
