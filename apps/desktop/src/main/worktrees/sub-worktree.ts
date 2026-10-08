import { dirname, join } from 'node:path';
import type { HookCallback, HookCallbackMatcher, HookEvent, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { err, ok, type Result, type TicketRecord, type TicketSubBranch } from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { GitService } from '../git/git-service';
import { BranchNamingError, nameSubAgent } from '../git/naming/branch-names';
import { isSameRepoPath, repoPathKey } from '../repos/repo-paths';
import type { TicketRecordStore } from '../tickets/record-store';
import { createKeyedQueue, type KeyedQueue } from './keyed-queue';
import { addWorktree, inspectPath, listBranchNames, undoWorktreeAdd, type WorktreeGit } from './worktree-git';

/**
 * Sub-agent worktrees (AL-084, design §9 step 3, Decision D9). Each writer sub-agent a ticket's
 * session spawns with worktree isolation gets its own branch `sub/<ticket>-<name>` off the ticket
 * branch, checked out at `<root>/<ticket>--<name>` next to the ticket worktree, so parallel edits never
 * collide. The session's SDK `WorktreeCreate` hook asks for it; `WorktreeRemove` keeps it (worktrees
 * are removed only when the user archives the ticket, AL-088). Read-only sub-agents (explore,
 * reviewer) are not isolated: they share the ticket worktree. Every sub-branch is recorded on the
 * ticket, which is what branch status (AL-085) and Merge sub-branches (AL-086) read.
 */
export interface SubWorktreeService {
  /**
   * The worktree for the ticket's sub-agent `name`: a new branch and worktree, the one already
   * recorded under that name (a resumed session asks again), or the ticket worktree for a read-only
   * agent type.
   */
  create(ticketId: string, name: string, options?: { agentType?: string }): Promise<Result<SubWorktree>>;
}

export interface SubWorktree {
  worktreePath: string;
  /** The sub-branch; the ticket branch when `shared`. */
  branch: string;
  /** A read-only sub-agent working in the ticket worktree itself. */
  shared: boolean;
  /** False when the sub-branch was already recorded (nothing new was created). */
  created: boolean;
}

export interface SubWorktreeServiceOptions {
  git: WorktreeGit & Pick<GitService, 'run'>;
  tickets: Pick<TicketRecordStore, 'get' | 'list' | 'update' | 'flush'>;
  /** Shared with the ticket worktree service when given, so worktree adds in one repo run one at a time. */
  queue?: KeyedQueue;
  now?: () => number;
  log?: { info(message: string): void; warn(message: string): void };
  /** Waits between attempts to remove a half-created worktree (tests pass zeros). */
  rollbackRetryDelaysMs?: readonly number[];
}

/**
 * Agent types that only read (design §9 step 3: "explore, reviewer"), compared without case and
 * punctuation. They share the ticket worktree even when their definition asks for isolation.
 */
export const READ_ONLY_AGENT_TYPES: readonly string[] = ['explore', 'explorer', 'plan', 'reviewer', 'code-reviewer', 'review'];

export function isReadOnlyAgentType(agentType: string | undefined): boolean {
  if (!agentType) return false;
  const key = agentType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return READ_ONLY_AGENT_TYPES.includes(key) || key.endsWith('-reviewer') || key.endsWith('-explorer');
}

const HEADS = 'refs/heads/';

export function createSubWorktreeService(options: SubWorktreeServiceOptions): SubWorktreeService {
  const { git, tickets } = options;
  const queue = options.queue ?? createKeyedQueue();
  const now = options.now ?? Date.now;
  const log = options.log ?? { info: () => undefined, warn: (message: string) => console.warn(`[worktrees] ${message}`) };

  async function createInRepo(record: TicketRecord, name: string): Promise<Result<SubWorktree>> {
    const recorded = record.subBranches.find((sub) => sub.name === name);
    if (recorded) return ok({ worktreePath: recorded.worktreePath, branch: recorded.branch, shared: false, created: false });

    const repo = record.repo;
    const start = await git.run(['rev-parse', '--verify', '--quiet', `${HEADS}${record.branch}^{commit}`], { cwd: repo, allowedExitCodes: [1] });
    const commit = start.stdout.trim();
    if (start.exitCode !== 0 || commit === '') {
      return err('VALIDATION', `The ticket branch ${record.branch} no longer exists, so no sub-branch can start from it.`, { reason: 'branch-missing' });
    }

    // Branches git has, plus every branch any ticket of this repo recorded (even ones deleted since).
    const all = await tickets.list();
    const recordedBranches = all
      .filter((other) => isSameRepoPath(other.repo, repo))
      .flatMap((other) => [other.branch, ...other.subBranches.map((sub) => sub.branch)]);
    let names;
    try {
      names = nameSubAgent(record.id, name, [...(await listBranchNames(git, repo)), ...recordedBranches]);
    } catch (error) {
      if (error instanceof BranchNamingError || error instanceof RangeError) return err('VALIDATION', error.message, { reason: 'invalid-name' });
      throw error;
    }
    const root = dirname(record.worktreePath);
    const worktreePath = join(root, names.worktreeDirName);
    const pathBefore = await inspectPath(worktreePath);
    if (pathBefore === 'occupied') {
      return err('VALIDATION', `${worktreePath} already exists. A sub-agent worktree is only created in a new or empty folder.`, {
        reason: 'path-occupied',
        worktreePath,
      });
    }

    const rollBack = async () => {
      const report = await undoWorktreeAdd(git, {
        repo,
        path: worktreePath,
        branch: names.branch,
        commit,
        pathBefore,
        root,
        rootBefore: true,
        retryDelaysMs: options.rollbackRetryDelaysMs,
      });
      if (!report.complete) log.warn(`Ticket ${record.id}: rolling back sub-branch ${names.branch} left ${report.leftovers.join(', ')}.`);
      return report;
    };

    try {
      await addWorktree(git, repo, { path: worktreePath, branch: names.branch, commit });
    } catch (error) {
      const rollback = await rollBack();
      if (!isGitError(error)) throw error;
      return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, rollback });
    }

    const sub: TicketSubBranch = { name, branch: names.branch, worktreePath, createdAt: now(), mergedAt: null };
    const saved = await tickets.update(record.id, (current) => ({ ...current, subBranches: [...current.subBranches, sub] }));
    if (!saved.ok) {
      const rollback = await rollBack();
      return err(saved.code, `The sub-branch could not be recorded on ticket ${record.id}: ${saved.message}`, { reason: 'record-failed', rollback });
    }
    const flushed = await tickets.flush(record.id);
    if (!flushed.ok) log.warn(`Ticket ${record.id}: sub-branch ${names.branch} is not written to disk yet: ${flushed.message}`);
    log.info(`Ticket ${record.id}: sub-agent "${name}" works on ${names.branch} in ${worktreePath}.`);
    return ok({ worktreePath, branch: names.branch, shared: false, created: true });
  }

  return {
    async create(ticketId, name, createOptions = {}) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found' });
      if (!name.trim()) return err('VALIDATION', 'A sub-agent worktree needs a name.', { reason: 'invalid-name' });
      if (isReadOnlyAgentType(createOptions.agentType)) {
        return ok({ worktreePath: record.worktreePath, branch: record.branch, shared: true, created: false });
      }
      try {
        return await queue(repoPathKey(record.repo), async () => {
          // Read again inside the queue: a sub-agent started just before may have added its branch.
          const current = await tickets.get(ticketId);
          return current ? createInRepo(current, name) : err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found' });
        });
      } catch (error) {
        if (isGitError(error)) return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code });
        return err('INTERNAL', `Creating the sub-agent worktree failed: ${error instanceof Error ? error.message : String(error)}`, { reason: 'unexpected' });
      }
    },
  };
}

/**
 * The SDK hooks a ticket's session gets (D9): `WorktreeCreate` answers with the sub-agent's worktree
 * path; `WorktreeRemove` keeps the worktree, since only Archive removes worktrees (§9 step 6).
 */
export function subWorktreeHooks(
  service: SubWorktreeService,
  ticketId: string,
  log?: { warn(message: string): void },
  /** A writer sub-agent got its sub-branch (sub-agent tracking links it to the sub-agent, AL-107). */
  onSubBranch?: (sub: { name: string; branch: string; agentType?: string; agentId?: string }) => void,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const onCreate: HookCallback = async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'WorktreeCreate') return {};
    const result = await service.create(ticketId, input.name, { agentType: input.agent_type });
    if (!result.ok) {
      log?.warn(`Ticket ${ticketId}: no worktree for sub-agent "${input.name}": ${result.message}`);
      // Blocking fails the sub-agent's spawn with the reason, rather than letting it edit the ticket worktree.
      return { decision: 'block', reason: result.message };
    }
    if (!result.data.shared) {
      onSubBranch?.({
        name: input.name,
        branch: result.data.branch,
        ...(input.agent_type ? { agentType: input.agent_type } : {}),
        ...(input.agent_id ? { agentId: input.agent_id } : {}),
      });
    }
    return { hookSpecificOutput: { hookEventName: 'WorktreeCreate', worktreePath: result.data.worktreePath } };
  };
  // Kept on purpose: the sub-branch still has to be merged, and Archive removes worktrees (AL-088).
  const onRemove: HookCallback = async () => ({});
  return {
    WorktreeCreate: [{ hooks: [onCreate] }],
    WorktreeRemove: [{ hooks: [onRemove] }],
  };
}
