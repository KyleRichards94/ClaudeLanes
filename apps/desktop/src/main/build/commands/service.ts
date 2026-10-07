import { err, ok, resolveRepoCommands, type DetectedCommands, type RepoCommands, type Result } from '@agent-lanes/contracts';
import { isSameRepoPath } from '../../repos/repo-paths';
import type { SettingsService } from '../../settings/service';
import { detectCommands } from './detect';

/**
 * A repo's build and run commands (AL-130, design §10): detected from its files on every call (cheap,
 * and a new solution or script is picked up at once), with the repo's `buildCommand` / `runCommand`
 * settings taking precedence (D63). Nothing is written anywhere.
 */
export interface BuildCommands {
  /** Detects commands in a folder: a repo's main checkout or a ticket's worktree. */
  detect(dir: string): Promise<DetectedCommands | null>;
  /**
   * The commands for a registered repo: its overrides, else what is detected in `dir` (the repo's
   * main checkout unless a ticket's worktree is given, which may be on a branch that changed them).
   * VALIDATION when no registered repo has that path.
   */
  forRepo(repoPath: string, options?: { dir?: string }): Promise<Result<RepoCommands>>;
}

export interface BuildCommandsOptions {
  settings: Pick<SettingsService, 'get'>;
  /** Decides whether repo paths compare without case; defaults to this machine's. */
  platform?: NodeJS.Platform;
  /** The file-based detector unless a test passes another. */
  detect?: (dir: string) => Promise<DetectedCommands | null>;
}

export function createBuildCommands({ settings, platform = process.platform, detect = detectCommands }: BuildCommandsOptions): BuildCommands {
  return {
    detect,

    async forRepo(repoPath, options = {}) {
      const repo = settings.get().repos.find((candidate) => isSameRepoPath(candidate.path, repoPath, platform));
      if (!repo) return err('VALIDATION', 'No registered repo has that path.');
      return ok(resolveRepoCommands(repo, await detect(options.dir ?? repo.path)));
    },
  };
}
