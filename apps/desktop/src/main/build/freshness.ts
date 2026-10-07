import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitService } from '../git';

/**
 * A worktree's state as one string (AL-133): Run skips its build step when the worktree still has the
 * fingerprint it had when the last successful build started. Built from git, so ignored build output
 * (bin/, obj/, dist/) never makes a build look stale: the HEAD commit plus every changed or untracked
 * path with its size and modification time. Null when it cannot be read (then Run always builds).
 */
export type WorktreeFingerprint = (worktreePath: string) => Promise<string | null>;

/** Past this many changed paths the fingerprint is not worth reading; Run just builds. */
const MAX_CHANGED_PATHS = 2_000;

export function createGitFingerprint(git: Pick<GitService, 'status'>): WorktreeFingerprint {
  return async (worktreePath) => {
    try {
      const status = await git.status(worktreePath, { untracked: 'all' });
      const changed = status.entries.filter((entry) => entry.kind !== 'ignored');
      if (changed.length > MAX_CHANGED_PATHS) return null;
      const hash = createHash('sha256').update(`head ${status.branch?.oid ?? 'none'}\n`);
      const parts = await Promise.all(
        changed.map(async (entry) => {
          const state = entry.kind === 'untracked' ? '?' : `${entry.index}${entry.worktree}`;
          try {
            const info = await stat(join(worktreePath, entry.path));
            return `${state} ${entry.path} ${info.size} ${info.mtimeMs}`;
          } catch {
            return `${state} ${entry.path} gone`;
          }
        }),
      );
      for (const part of parts.sort()) hash.update(`${part}\n`);
      return hash.digest('hex');
    } catch {
      return null;
    }
  };
}
