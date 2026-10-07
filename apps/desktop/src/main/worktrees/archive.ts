import { rm } from 'node:fs/promises';
import {
  err,
  ok,
  type ArchiveLeftover,
  type ArchiveTicketResult,
  type Result,
  type TicketRecord,
  type UnmergedWork,
} from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { GitService } from '../git/git-service';
import { isSameRepoPath, repoPathKey } from '../repos/repo-paths';
import type { TicketArchive } from '../tickets/archive-store';
import type { TicketRecordStore } from '../tickets/record-store';
import { readWorktreeState, refExists, resolveBaseRef } from './branch-status';
import { createKeyedQueue, type KeyedQueue } from './keyed-queue';
import { findRegisteredWorktree, inspectPath, isWorktreeFolderOf } from './worktree-git';

/**
 * Archive (AL-088, design §9 step 6: "The worktree is removed only when the user chooses Archive").
 * Nothing in the app calls it except the `tickets:archive` channel, which needs `confirmed: true`.
 *
 * 1. Refuses while any of the ticket's branches has commits that are not merged, or a worktree has
 *    uncommitted changes, until the user confirms a second time (`discardUnmerged`).
 * 2. Removes the sub-worktrees, then the ticket worktree (`git worktree remove`, then `prune`).
 *    Windows may keep a file locked for a moment (antivirus, indexer, an editor), so each removal is
 *    retried; long paths are handled with `core.longpaths` and Node's own removal as a fallback.
 * 3. Optionally deletes branches already merged into the base; unmerged branches are always kept, so
 *    no commit becomes unreachable.
 * 4. Moves the record to the archive list. If any worktree could not be removed, the record stays on
 *    the board and the leftovers are reported; Archive can simply be run again.
 */
export interface ArchiveService {
  archive(ticketId: string, options?: { discardUnmerged?: boolean; deleteMergedBranches?: boolean }): Promise<Result<ArchiveTicketResult>>;
}

export interface ArchiveServiceOptions {
  git: Pick<GitService, 'run' | 'status' | 'worktrees' | 'aheadBehind' | 'ensureSupported'>;
  tickets: Pick<TicketRecordStore, 'get' | 'delete'>;
  archive: Pick<TicketArchive, 'add'>;
  now?: () => number;
  log?: { info(message: string): void; warn(message: string): void };
  /** Waits between attempts to remove a locked worktree; tests pass zeros. */
  retryDelaysMs?: readonly number[];
  /** Shared with other services that change a repo's branches, so they run one at a time per repo. */
  queue?: KeyedQueue;
  /** Deletes a worktree folder git could not (tests simulate a locked file). */
  removeFolder?: (path: string) => Promise<void>;
}

const HEADS = 'refs/heads/';
const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 3_000];
/** Git on Windows refuses paths over 260 characters unless told otherwise. */
const LONG_PATHS = ['-c', 'core.longpaths=true'];

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function reasonOf(error: unknown): string {
  if (isGitError(error)) {
    const line = error.stderr.split(/\r?\n/).find((text) => /^(fatal|error):/i.test(text.trim()));
    return line ? line.trim().replace(/^(fatal|error):\s*/i, '') : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createArchiveService(options: ArchiveServiceOptions): ArchiveService {
  const { git, tickets } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? { info: () => undefined, warn: (message: string) => console.warn(`[archive] ${message}`) };
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const queue = options.queue ?? createKeyedQueue();
  const removeFolder = options.removeFolder ?? ((path: string) => rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));

  /** Commits on `branch` not reachable from any of `into`; null when the branch is gone. */
  async function unmergedCommits(repo: string, branch: string, into: readonly string[]): Promise<number | null> {
    if (!(await refExists(git, repo, `${HEADS}${branch}`))) return null;
    const { stdout } = await git.run(['rev-list', '--count', `${HEADS}${branch}`, '--not', ...into, '--'], { cwd: repo });
    return Number(stdout.trim()) || 0;
  }

  async function findUnmerged(record: TicketRecord, baseRef: string | null): Promise<UnmergedWork> {
    const { repo } = record;
    const bases = baseRef ? [baseRef] : [];
    const branches: UnmergedWork['branches'] = [];
    const ticketCommits = await unmergedCommits(repo, record.branch, bases);
    if (ticketCommits) branches.push({ branch: record.branch, commits: ticketCommits });
    const ticketRef = `${HEADS}${record.branch}`;
    const ticketExists = await refExists(git, repo, ticketRef);
    for (const sub of record.subBranches) {
      const commits = await unmergedCommits(repo, sub.branch, ticketExists ? [...bases, ticketRef] : bases);
      if (commits) branches.push({ branch: sub.branch, commits });
    }
    const dirtyWorktrees: string[] = [];
    for (const path of [record.worktreePath, ...record.subBranches.map((sub) => sub.worktreePath)]) {
      const state = await readWorktreeState(git, path);
      if (state.dirty) dirtyWorktrees.push(path);
    }
    return { branches, dirtyWorktrees };
  }

  /** Removes one worktree; resolves the reason it could not, or null once it is gone. */
  async function removeWorktree(repo: string, path: string, force: boolean): Promise<string | null> {
    const registered = async () => (await findRegisteredWorktree(git, repo, path)) !== undefined;
    let reason: string | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1] ?? 0);
      if (!(await registered())) {
        reason = null;
        break;
      }
      try {
        await git.run([...LONG_PATHS, 'worktree', 'remove', ...(force ? ['--force'] : []), path], { cwd: repo });
        reason = null;
        break;
      } catch (error) {
        if (!isGitError(error)) throw error;
        reason = reasonOf(error);
        // A file git could not delete (locked, or a path too long for git): finish with Node's removal,
        // but only in a folder git made for this repo, then let `prune` drop git's record of it.
        const clean = force || (await readWorktreeState(git, path).catch(() => null))?.dirty === false;
        if (clean && (await isWorktreeFolderOf(git, repo, path).catch(() => false))) {
          try {
            await removeFolder(path);
            await git.run(['worktree', 'prune'], { cwd: repo });
            if (!(await registered())) {
              reason = null;
              break;
            }
          } catch (cause) {
            reason = reasonOf(cause);
          }
        }
      }
    }
    await git.run(['worktree', 'prune'], { cwd: repo }).catch(() => undefined);
    if (reason === null) return null;
    // Git may have unregistered it while a locked file kept the folder: report what is actually left.
    const stillRegistered = await registered().catch(() => true);
    const folder = await inspectPath(path).catch(() => 'occupied' as const);
    if (!stillRegistered && folder === 'missing') return null;
    return reason;
  }

  async function archiveInRepo(record: TicketRecord, discardUnmerged: boolean, deleteMergedBranches: boolean): Promise<Result<ArchiveTicketResult>> {
    const { repo } = record;
    const base = await resolveBaseRef(git, repo, record.baseBranch);

    const unmerged = await findUnmerged(record, base?.ref ?? null);
    if (!discardUnmerged && (unmerged.branches.length > 0 || unmerged.dirtyWorktrees.length > 0)) {
      const parts = [
        ...unmerged.branches.map((entry) => `${entry.branch} has ${entry.commits} unmerged commit${entry.commits === 1 ? '' : 's'}`),
        ...unmerged.dirtyWorktrees.map((path) => `${path} has uncommitted changes`),
      ];
      return err('VALIDATION', `${parts.join('; ')}. Confirm again to archive anyway.`, { reason: 'unmerged-work', ...unmerged });
    }

    // Sub-worktrees first: they branch off the ticket branch.
    const paths = [...record.subBranches.map((sub) => sub.worktreePath), record.worktreePath];
    const removedWorktrees: string[] = [];
    const leftovers: ArchiveLeftover[] = [];
    for (const path of paths) {
      const reason = await removeWorktree(repo, path, discardUnmerged);
      if (reason === null) removedWorktrees.push(path);
      else leftovers.push({ kind: 'worktree', target: path, reason });
    }
    if (leftovers.length > 0) {
      log.warn(`Ticket ${record.id}: archive left ${leftovers.map((entry) => entry.target).join(', ')}; the ticket stays on the board.`);
      return ok({ status: 'partial', removedWorktrees, leftovers });
    }

    const deletedBranches: string[] = [];
    const keptBranches: string[] = [];
    // Sub-branches first, so each is still checked against the ticket branch.
    for (const branch of [...record.subBranches.map((sub) => sub.branch), record.branch]) {
      const ref = `${HEADS}${branch}`;
      if (!(await refExists(git, repo, ref))) continue;
      const merged = base !== null && (await unmergedCommits(repo, branch, [base.ref])) === 0;
      if (!deleteMergedBranches || !merged) {
        keptBranches.push(branch);
        continue;
      }
      try {
        const commit = (await git.run(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repo })).stdout.trim();
        await git.run(['update-ref', '-d', ref, commit], { cwd: repo });
        deletedBranches.push(branch);
      } catch (error) {
        if (!isGitError(error)) throw error;
        log.warn(`Ticket ${record.id}: could not delete ${branch}: ${reasonOf(error)}`);
        keptBranches.push(branch);
      }
    }

    const archived = { archivedAt: now(), record, deletedBranches, keptBranches };
    await options.archive.add(archived);
    const removed = await tickets.delete(record.id);
    if (!removed.ok) return removed;
    log.info(`Ticket ${record.id}: archived; removed ${removedWorktrees.length} worktree(s), deleted ${deletedBranches.length} merged branch(es).`);
    return ok({ status: 'archived', archived });
  }

  return {
    async archive(ticketId, { discardUnmerged = false, deleteMergedBranches = false } = {}) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found', ticketId });
      try {
        await git.ensureSupported();
        return await queue(repoPathKey(record.repo), async (): Promise<Result<ArchiveTicketResult>> => {
          const current = await tickets.get(ticketId);
          if (!current || !isSameRepoPath(current.repo, record.repo)) {
            return err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found', ticketId });
          }
          return archiveInRepo(current, discardUnmerged, deleteMergedBranches);
        });
      } catch (error) {
        if (isGitError(error)) return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode });
        throw error;
      }
    },
  };
}
