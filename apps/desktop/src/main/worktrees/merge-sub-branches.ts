import { isAbsolute, join } from 'node:path';
import {
  OPEN_CONFLICT_FILES_LIMIT,
  err,
  ok,
  type Err,
  type HandConflictResult,
  type MergedSubBranch,
  type MergeSubBranchesResult,
  type OpenConflictFilesResult,
  type Result,
  type SkippedSubBranch,
  type TicketRecord,
} from '@agent-lanes/contracts';
import type { SessionManager } from '../agent/session-manager';
import { isGitError } from '../git/git-error';
import type { CallOptions, GitService } from '../git/git-service';
import { repoPathKey } from '../repos/repo-paths';
import type { TicketRecordStore } from '../tickets/record-store';
import type { BranchStatusService } from './branch-status';
import { createKeyedQueue, type KeyedQueue } from './keyed-queue';

/**
 * Merge sub-branches → ticket branch (AL-086, design §9 step 4, R9): every ready sub-branch is merged
 * into the ticket branch in creation order, each with `--no-ff`, inside the ticket worktree. The first
 * conflict stops the run: that merge stays in progress in the ticket worktree and `MERGE_CONFLICT`
 * lists its files; nothing after the conflicting branch is merged. The user then picks:
 *
 * - "Hand to lead agent": a user turn tells the ticket's lead agent which files conflict, so it
 *   resolves them and commits the merge in the worktree it already works in;
 * - "I'll resolve it": the conflicted files open in the user's editor.
 */
export interface MergeSubBranchesService {
  merge(ticketId: string, call?: CallOptions): Promise<Result<MergeSubBranchesResult>>;
  handToLead(ticketId: string): Promise<Result<HandConflictResult>>;
  openConflictFiles(ticketId: string): Promise<Result<OpenConflictFilesResult>>;
}

export interface MergeSubBranchesServiceOptions {
  git: Pick<GitService, 'run' | 'status' | 'ensureSupported'>;
  tickets: Pick<TicketRecordStore, 'get' | 'update' | 'flush'>;
  branches: Pick<BranchStatusService, 'status'>;
  sessions: Pick<SessionManager, 'send'>;
  /** Opens a file in the user's editor (Electron `shell.openPath`); resolves an error message or ''. */
  openPath: (path: string) => Promise<string>;
  /** Shared with the other services that change a repo's branches, so they run one at a time per repo. */
  queue?: KeyedQueue;
  now?: () => number;
  log?: { info(message: string): void; warn(message: string): void };
}

const HEADS = 'refs/heads/';
/** Files listed in a GIT_DIRTY or MERGE_CONFLICT result; the count is always given. */
const MAX_LISTED_FILES = 100;

class Refusal extends Error {
  constructor(readonly result: Err) {
    super(result.message);
  }
}

function refuse(code: Err['code'], reason: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new Refusal(err(code, message, { reason, ...extra }));
}

function listed(files: string[]) {
  return { files: files.slice(0, MAX_LISTED_FILES), fileCount: files.length };
}

/** The user turn "Hand to lead agent" sends. */
export function conflictHandOffMessage(source: string | null, target: string, files: readonly string[]): string {
  const what = source ? `Merging ${source} into ${target}` : `The merge into ${target}`;
  const shown = files.slice(0, MAX_LISTED_FILES).map((file) => `- ${file}`);
  if (files.length > MAX_LISTED_FILES) shown.push(`- … and ${files.length - MAX_LISTED_FILES} more`);
  return [
    `${what} stopped on conflicts in ${files.length === 1 ? '1 file' : `${files.length} files`}:`,
    ...shown,
    '',
    'The merge is in progress in your worktree. Resolve each conflict keeping the intent of both sides, run the build and tests, then commit the merge (`git commit --no-edit`). Tell me when it is done.',
  ].join('\n');
}

export function createMergeSubBranchesService(options: MergeSubBranchesServiceOptions): MergeSubBranchesService {
  const { git, tickets, branches, sessions } = options;
  const queue = options.queue ?? createKeyedQueue();
  const now = options.now ?? Date.now;
  const log = options.log ?? { info: () => undefined, warn: (message: string) => console.warn(`[merge] ${message}`) };

  async function load(ticketId: string): Promise<TicketRecord> {
    const record = await tickets.get(ticketId);
    if (!record) refuse('VALIDATION', 'ticket-not-found', `There is no ticket ${ticketId}.`, { ticketId });
    return record;
  }

  /** Conflicted paths in the ticket worktree, and whether a merge is in progress there. */
  async function conflictState(worktree: string, call: CallOptions = {}): Promise<{ inProgress: boolean; files: string[] }> {
    const status = await git.status(worktree, call);
    const files = status.entries.filter((entry) => entry.kind === 'unmerged').map((entry) => entry.path);
    const head = await git.run(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: worktree, allowedExitCodes: [1], ...call });
    return { inProgress: head.exitCode === 0, files };
  }

  async function mergeOne(record: TicketRecord, branch: string, call: CallOptions): Promise<{ commit: string } | { conflicts: string[] }> {
    const worktree = record.worktreePath;
    const result = await git.run(
      ['merge', '--no-ff', '--no-edit', '--quiet', '-m', `Merge ${branch} into ${record.branch}`, '--end-of-options', `${HEADS}${branch}`],
      { cwd: worktree, allowedExitCodes: [1, 2, 128], ...call },
    );
    if (result.exitCode === 0) {
      return { commit: (await git.run(['rev-parse', 'HEAD'], { cwd: worktree, ...call })).stdout.trim() };
    }
    const state = await conflictState(worktree, call);
    // A conflict stays in progress for the lead agent or the user to resolve.
    if (state.files.length > 0) return { conflicts: state.files };
    // Anything else (an untracked file in the way, …) leaves no merge behind.
    if (state.inProgress) await git.run(['merge', '--abort'], { cwd: worktree });
    const reason = result.stderr.split(/\r?\n/).find((line) => line.trim() !== '') ?? `git merge exited with ${result.exitCode}`;
    refuse('INTERNAL', 'git-failed', `Merging ${branch} into ${record.branch} failed: ${reason.trim()}`, { branch, exitCode: result.exitCode });
  }

  async function mergeInRepo(ticketId: string, call: CallOptions): Promise<MergeSubBranchesResult> {
    const record = await load(ticketId);
    const status = await branches.status(ticketId, call);
    if (!status.ok) throw new Refusal(status);
    const ticket = status.data.ticket;
    if (!ticket.present) refuse('VALIDATION', 'worktree-missing', `The worktree of ticket ${ticketId} is missing: ${record.worktreePath}.`);

    const before = await conflictState(record.worktreePath, call);
    if (before.inProgress || before.files.length > 0) {
      refuse('MERGE_CONFLICT', 'merge-in-progress', `A merge into ${record.branch} is still in progress. Resolve its conflicts first.`, listed(before.files));
    }
    if (ticket.dirty) {
      const state = await git.status(record.worktreePath, call);
      const files = state.entries.filter((entry) => entry.kind !== 'ignored').map((entry) => entry.path);
      refuse('GIT_DIRTY', 'worktree-dirty', `The ticket worktree has uncommitted changes. Commit them before merging sub-branches.`, listed(files));
    }

    // Creation order is the order they are merged in (§9 step 4).
    const order = new Map(record.subBranches.map((sub) => [sub.branch, sub.createdAt]));
    const subs = [...status.data.subBranches].sort((a, b) => (order.get(a.branch) ?? 0) - (order.get(b.branch) ?? 0));
    const merged: MergedSubBranch[] = [];
    const skipped: SkippedSubBranch[] = [];

    const save = async () => {
      if (merged.length === 0) return;
      const at = now();
      const done = new Set(merged.map((entry) => entry.branch));
      const saved = await tickets.update(ticketId, (current) => ({
        ...current,
        subBranches: current.subBranches.map((sub) => (done.has(sub.branch) ? { ...sub, mergedAt: at } : sub)),
      }));
      if (!saved.ok) log.warn(`Ticket ${ticketId}: merged ${[...done].join(', ')} but could not record it: ${saved.message}`);
      else await tickets.flush(ticketId);
    };

    for (const sub of subs) {
      if (!sub.ready) {
        skipped.push({ name: sub.name, branch: sub.branch, reason: 'not-ready' });
        continue;
      }
      if (!sub.ahead) {
        skipped.push({ name: sub.name, branch: sub.branch, reason: 'nothing-to-merge' });
        continue;
      }
      const outcome = await mergeOne(record, sub.branch, call).catch(async (error: unknown) => {
        await save();
        throw error;
      });
      if ('conflicts' in outcome) {
        await save();
        log.info(`Ticket ${ticketId}: merging ${sub.branch} into ${record.branch} conflicts in ${outcome.conflicts.length} file(s); stopped.`);
        refuse('MERGE_CONFLICT', 'conflict', `Merging ${sub.branch} into ${record.branch} conflicts in ${outcome.conflicts.length === 1 ? '1 file' : `${outcome.conflicts.length} files`}. Branches after it were not merged.`, {
          ...listed(outcome.conflicts),
          name: sub.name,
          branch: sub.branch,
          merged,
        });
      }
      merged.push({ name: sub.name, branch: sub.branch, commit: outcome.commit });
    }
    await save();
    if (merged.length > 0) log.info(`Ticket ${ticketId}: merged ${merged.map((entry) => entry.branch).join(', ')} into ${record.branch}.`);
    return { ticketId, target: record.branch, merged, skipped };
  }

  async function guarded<T>(task: () => Promise<T>): Promise<Result<T>> {
    try {
      return ok(await task());
    } catch (error) {
      if (error instanceof Refusal) return error.result;
      if (isGitError(error, 'ABORTED')) return err('INTERNAL', 'The merge was cancelled.', { reason: 'aborted' });
      if (isGitError(error)) return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode });
      throw error;
    }
  }

  /** The conflict in the ticket worktree, or VALIDATION `no-conflict`. */
  async function currentConflict(ticketId: string): Promise<{ record: TicketRecord; files: string[]; source: string | null }> {
    const record = await load(ticketId);
    const { files } = await conflictState(record.worktreePath);
    if (files.length === 0) refuse('VALIDATION', 'no-conflict', `Nothing conflicts in the worktree of ticket ${ticketId}.`);
    const head = (await git.run(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: record.worktreePath, allowedExitCodes: [1] })).stdout.trim();
    let source: string | null = null;
    for (const sub of record.subBranches) {
      if (!head) break;
      const tip = await git.run(['rev-parse', '--verify', '--quiet', `${HEADS}${sub.branch}`], { cwd: record.repo, allowedExitCodes: [1] });
      if (tip.stdout.trim() === head) {
        source = sub.branch;
        break;
      }
    }
    return { record, files, source };
  }

  return {
    merge: (ticketId, call = {}) =>
      guarded(async () => {
        const record = await load(ticketId);
        await git.ensureSupported(call);
        return queue(repoPathKey(record.repo), () => mergeInRepo(ticketId, call));
      }),

    handToLead: (ticketId) =>
      guarded(async () => {
        const { record, files, source } = await currentConflict(ticketId);
        const sent = sessions.send(ticketId, { text: conflictHandOffMessage(source, record.branch, files), priority: 'next' });
        if (!sent.ok) throw new Refusal(sent);
        return { files, held: sent.data.held };
      }),

    openConflictFiles: (ticketId) =>
      guarded(async () => {
        const { record, files } = await currentConflict(ticketId);
        const opened: string[] = [];
        for (const file of files.slice(0, OPEN_CONFLICT_FILES_LIMIT)) {
          // Status paths are relative to the worktree; never open anything outside it.
          if (isAbsolute(file) || file.split(/[\\/]/).includes('..')) continue;
          const path = join(record.worktreePath, file);
          const problem = await options.openPath(path);
          if (problem) log.warn(`Ticket ${ticketId}: could not open ${path}: ${problem}`);
          else opened.push(path);
        }
        return { opened, fileCount: files.length };
      }),
  };
}
