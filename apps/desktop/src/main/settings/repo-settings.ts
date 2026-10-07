import { basename, dirname, join } from 'node:path';
import {
  DEFAULT_BASE_BRANCH,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  type RepoSettings,
} from '@agent-lanes/contracts';

/** Folder next to the repo that holds its ticket worktrees (design §9: `../.agent-lanes/<id>`). */
export const WORKTREE_FOLDER = '.agent-lanes';

/**
 * Settings for a newly registered repo: named after its folder, worktrees in `<repo>/../.agent-lanes`,
 * detected build/run commands, and the default agent cap. The repo registry (AL-081) passes the base
 * branch it detects.
 */
export function createRepoSettings(path: string, overrides: Partial<Omit<RepoSettings, 'path'>> = {}): RepoSettings {
  return {
    path,
    name: basename(path) || path,
    baseBranch: DEFAULT_BASE_BRANCH,
    worktreeRoot: join(dirname(path), WORKTREE_FOLDER),
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
    ...overrides,
  };
}
