import { execFile } from 'node:child_process';
import type { CheckRefFormat } from './check-branch-name';

export interface GitCheckRefFormatOptions {
  /** Folder git runs in. Results don't depend on it once `checkBranchName` has passed. */
  cwd?: string;
  /** Default 10 s. */
  timeoutMs?: number;
  /** Default `git` on PATH. */
  gitPath?: string;
}

/**
 * `git check-ref-format --branch <name>` through `execFile` (no shell, so the name is one argv
 * entry and can't break the command). Resolves true or false on git's exit code; rejects when git
 * can't run or times out.
 *
 * Stop-gap until the git runner (AL-080) lands: the git service should then pass a `CheckRefFormat`
 * built on that runner instead.
 */
export function createGitCheckRefFormat(options: GitCheckRefFormatOptions = {}): CheckRefFormat {
  const { cwd, timeoutMs = 10_000, gitPath = 'git' } = options;
  return (name) =>
    new Promise((resolve, reject) => {
      // A leading "-" would be read as an option; git refuses such branch names anyway.
      if (name.startsWith('-')) {
        resolve(false);
        return;
      }
      execFile(
        gitPath,
        ['check-ref-format', '--branch', name],
        { cwd, timeout: timeoutMs, windowsHide: true },
        (error) => {
          if (error === null) resolve(true);
          else if (typeof error.code === 'number') resolve(false);
          else reject(error);
        },
      );
    });
}
