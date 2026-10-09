import { err, ok, type Result, type WorktreeFiles } from '@agent-lanes/contracts';
import type { GitService } from '../git';
import type { TicketRecordStore } from '../tickets';

/** Most paths returned for the composer's `@` picker (AL-259). */
export const WORKTREE_FILES_LIMIT = 50;
/** Most paths read from git before filtering. */
const SCAN_LIMIT = 50_000;

export interface WorktreeFileLister {
  /** Tracked and untracked (not ignored) files of the ticket worktree whose path contains every word of `query`. */
  list(ticketId: string, query: string): Promise<Result<WorktreeFiles>>;
}

/** Paths whose lower-cased form contains every query word, shortest first. */
export function matchPaths(paths: readonly string[], query: string, limit = WORKTREE_FILES_LIMIT): { files: string[]; truncated: boolean } {
  const words = query.toLowerCase().split(/[\s/\\]+/).filter(Boolean);
  const matches = (words.length === 0 ? [...paths] : paths.filter((path) => words.every((word) => path.toLowerCase().includes(word)))).sort(
    (a, b) => a.length - b.length || (a < b ? -1 : 1),
  );
  return { files: matches.slice(0, limit), truncated: matches.length > limit };
}

export function createWorktreeFileLister(options: { git: Pick<GitService, 'run'>; tickets: Pick<TicketRecordStore, 'get'> }): WorktreeFileLister {
  return {
    async list(ticketId, query) {
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const listed = await options.git.run(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: record.worktreePath, maxOutputBytes: 32 * 1024 * 1024 });
      const paths = listed.stdout.split('\0').filter(Boolean).slice(0, SCAN_LIMIT);
      return ok({ ticketId, query, ...matchPaths(paths, query) });
    },
  };
}
