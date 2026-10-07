import { err, ok, type BranchStatus, type Result, type SubBranchStatus, type TicketRecord, type WorktreeState } from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { CallOptions, GitService } from '../git/git-service';
import { hasConflicts, isCleanStatus } from '../git/porcelain';
import type { TicketRecordStore } from '../tickets/record-store';

/**
 * Branch status for the drill-in's Sub-branches panel and Merge panel (AL-085, artboard 3
 * "4 ahead · Ready"): the ticket branch against its base, and each sub-branch against the ticket
 * branch, with ahead/behind counts, whether its worktree is dirty, and whether it is ready to merge
 * (clean and its sub-agent finished). Read-only: never fetches, never takes index.lock (AL-080 D175).
 */
export interface BranchStatusService {
  status(ticketId: string, call?: CallOptions): Promise<Result<BranchStatus>>;
}

/** Which sub-agents are still working. The session manager (AL-100, AL-107) provides it. */
export interface SubagentActivity {
  /** True while the ticket's sub-agent named `name` runs. */
  isRunning(ticketId: string, name: string): boolean;
}

/** Until the session manager exists nothing runs, so every sub-agent counts as finished. */
export const NO_SUBAGENTS_RUNNING: SubagentActivity = { isRunning: () => false };

export interface BranchStatusServiceOptions {
  git: Pick<GitService, 'run' | 'status' | 'aheadBehind'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  subagents?: SubagentActivity;
  now?: () => number;
}

const HEADS = 'refs/heads/';

/** True when `ref` names a commit in `repo`. */
export async function refExists(git: Pick<GitService, 'run'>, repo: string, ref: string, call: CallOptions = {}): Promise<boolean> {
  const { exitCode } = await git.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], {
    cwd: repo,
    allowedExitCodes: [1],
    ...call,
  });
  return exitCode === 0;
}

/**
 * The ref a ticket's base is compared with and merged into: the local base branch when it exists,
 * else `origin/<base>`; null when neither does.
 */
export async function resolveBaseRef(
  git: Pick<GitService, 'run'>,
  repo: string,
  base: string,
  call: CallOptions = {},
): Promise<{ name: string; ref: string } | null> {
  if (await refExists(git, repo, `${HEADS}${base}`, call)) return { name: base, ref: `${HEADS}${base}` };
  if (await refExists(git, repo, `refs/remotes/origin/${base}`, call)) return { name: `origin/${base}`, ref: `refs/remotes/origin/${base}` };
  return null;
}

/** `git status` of one worktree; a worktree whose folder is gone is `present: false`. */
export async function readWorktreeState(
  git: Pick<GitService, 'status'>,
  worktreePath: string,
  call: CallOptions = {},
): Promise<WorktreeState> {
  try {
    const status = await git.status(worktreePath, call);
    const changed = status.entries.filter((entry) => entry.kind !== 'ignored').length;
    return { worktreePath, present: true, dirty: !isCleanStatus(status), changedFiles: changed, conflicted: hasConflicts(status) };
  } catch (error) {
    // CWD_NOT_FOUND: the folder is gone. NOT_A_REPO: a folder is there but git no longer knows it as a worktree.
    if (isGitError(error, 'CWD_NOT_FOUND') || isGitError(error, 'NOT_A_REPO')) {
      return { worktreePath, present: false, dirty: null, changedFiles: null, conflicted: false };
    }
    throw error;
  }
}

/** Ahead/behind of `head` against `base`, or nulls when either is missing. */
async function compare(
  git: Pick<GitService, 'run' | 'aheadBehind'>,
  repo: string,
  base: string | null,
  head: string,
  call: CallOptions,
): Promise<{ ahead: number | null; behind: number | null }> {
  if (base === null || !(await refExists(git, repo, `${HEADS}${head}`, call))) return { ahead: null, behind: null };
  return git.aheadBehind(repo, base, `${HEADS}${head}`, call);
}

export function createBranchStatusService(options: BranchStatusServiceOptions): BranchStatusService {
  const { git, tickets } = options;
  const subagents = options.subagents ?? NO_SUBAGENTS_RUNNING;
  const now = options.now ?? Date.now;

  async function read(record: TicketRecord, call: CallOptions): Promise<BranchStatus> {
    const { repo } = record;
    const ticketBranchExists = await refExists(git, repo, `${HEADS}${record.branch}`, call);
    const [baseRef, ticketState] = await Promise.all([
      resolveBaseRef(git, repo, record.baseBranch, call),
      readWorktreeState(git, record.worktreePath, call),
    ]);
    const ticketCounts = await compare(git, repo, baseRef?.ref ?? null, record.branch, call);

    const subBranches = await Promise.all(
      record.subBranches.map(async (sub): Promise<SubBranchStatus> => {
        const [state, counts] = await Promise.all([
          readWorktreeState(git, sub.worktreePath, call),
          compare(git, repo, ticketBranchExists ? `${HEADS}${record.branch}` : null, sub.branch, call),
        ]);
        const finished = !subagents.isRunning(record.id, sub.name);
        // A dirty, conflicted or missing worktree is never ready: its work is not all committed.
        const ready = state.present && state.dirty === false && !state.conflicted && finished && counts.ahead !== null;
        return { ...state, name: sub.name, branch: sub.branch, ...counts, finished, ready, mergedAt: sub.mergedAt };
      }),
    );

    return {
      ticketId: record.id,
      ticket: { ...ticketState, branch: record.branch, baseBranch: record.baseBranch, baseRef: baseRef?.name ?? null, ...ticketCounts },
      subBranches,
      checkedAt: now(),
    };
  }

  return {
    async status(ticketId, call = {}) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found', ticketId });
      try {
        return ok(await read(record, call));
      } catch (error) {
        if (isGitError(error)) return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode });
        throw error;
      }
    },
  };
}
