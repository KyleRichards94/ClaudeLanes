import {
  err,
  ok,
  type Err,
  type MergeToMainPreview,
  type MergeToMainResult,
  type Result,
  type TicketRecord,
  type MergeTarget,
} from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { CallOptions, GitService } from '../git/git-service';
import type { GitStatus } from '../git/porcelain';
import { isSameRepoPath, repoPathKey } from '../repos/repo-paths';
import type { TicketRecordStore } from '../tickets/record-store';
import { readWorktreeState, refExists } from './branch-status';
import { createKeyedQueue, type KeyedQueue } from './keyed-queue';
import { fetchBase } from './worktree-git';

/**
 * Merge worktree → main (AL-087, design §9 step 5, R9, §13 "Merge to main without review"):
 *
 * 1. Refuses (`GIT_DIRTY`) while the ticket worktree has uncommitted changes, and warns (refuses
 *    until `acceptQaWarning`) when QA has not passed.
 * 2. Fetches `origin/<base>` and fast-forwards the local base to it, so the push that follows is not
 *    rejected; a base that has moved on both sides is refused rather than rewritten.
 * 3. Merges the ticket branch into the base with `--no-ff`. When the base is checked out (normally in
 *    the repo's main checkout) the merge runs there, and that checkout must have no staged or unstaged
 *    changes; when it is checked out nowhere, `git merge-tree` builds the merge without touching any
 *    working tree. A conflict changes nothing and returns `MERGE_CONFLICT` with the files.
 * 4. Pushes the base to origin (no force), then moves the card to Done.
 *
 * Trying again after a failed push skips the merge (the ticket branch is already in the base) and only
 * pushes, so the operation is safe to repeat. Merges in one repo run one at a time.
 */
export interface MergeToMainService {
  preview(ticketId: string, call?: CallOptions): Promise<Result<MergeToMainPreview>>;
  merge(ticketId: string, options?: { acceptQaWarning?: boolean; target?: MergeTarget } & CallOptions): Promise<Result<MergeToMainResult>>;
}

export interface MergeToMainServiceOptions {
  git: Pick<GitService, 'run' | 'status' | 'worktrees' | 'aheadBehind' | 'ensureSupported'>;
  tickets: Pick<TicketRecordStore, 'get' | 'update' | 'flush'>;
  now?: () => number;
  log?: { info(message: string): void; warn(message: string): void };
  /** Shared with other services that change a repo's branches, so they run one at a time per repo. */
  queue?: KeyedQueue;
}

const HEADS = 'refs/heads/';
const ORIGIN = 'refs/remotes/origin/';
/** Files listed in a GIT_DIRTY or MERGE_CONFLICT result; the count is always given. */
const MAX_LISTED_FILES = 100;

/** QA passed: the ticket entered QA and later moved on to Create PR or Done, without going back since. */
export function qaPassed(record: TicketRecord): boolean {
  if (record.stage !== 'create-pr' && record.stage !== 'done') return false;
  const lastQa = record.stageHistory.findLastIndex((entry) => entry.stage === 'qa');
  if (lastQa === -1) return false;
  const since = record.stageHistory.slice(lastQa + 1);
  return since.length > 0 && since.every((entry) => entry.stage === 'create-pr' || entry.stage === 'done');
}

function dirtyFiles(status: GitStatus, { tracked }: { tracked: boolean }): string[] {
  return status.entries
    .filter((entry) => entry.kind !== 'ignored' && (!tracked || entry.kind !== 'untracked'))
    .map((entry) => entry.path);
}

function listed(files: string[]) {
  return { files: files.slice(0, MAX_LISTED_FILES), fileCount: files.length };
}

class MergeRefusal extends Error {
  constructor(readonly result: Err) {
    super(result.message);
  }
}

function refuse(code: Err['code'], reason: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new MergeRefusal(err(code, message, { reason, ...extra }));
}

/** True when `ancestor` is contained in `descendant`. */
async function isAncestor(git: MergeToMainServiceOptions['git'], repo: string, ancestor: string, descendant: string, call: CallOptions) {
  const { exitCode } = await git.run(['merge-base', '--is-ancestor', '--end-of-options', ancestor, descendant], {
    cwd: repo,
    allowedExitCodes: [1],
    ...call,
  });
  return exitCode === 0;
}

async function commitOf(git: MergeToMainServiceOptions['git'], repo: string, ref: string, call: CallOptions): Promise<string> {
  return (await git.run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: repo, ...call })).stdout.trim();
}

function mergeMessage(record: TicketRecord, target: string = record.baseBranch): string {
  const subject = `Merge branch '${record.branch}' into ${target}`;
  const workItem = record.ado ? `Work item #${record.ado.workItemId}: ${record.title}` : record.title;
  return workItem.trim() === '' ? subject : `${subject}\n\n${workItem}`;
}

export function createMergeToMainService(options: MergeToMainServiceOptions): MergeToMainService {
  const { git, tickets } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? { info: () => undefined, warn: (message: string) => console.warn(`[merge] ${message}`) };
  const inRepo = options.queue ?? createKeyedQueue();

  async function load(ticketId: string): Promise<TicketRecord> {
    const record = await tickets.get(ticketId);
    if (!record) refuse('VALIDATION', 'ticket-not-found', `There is no ticket ${ticketId}.`, { ticketId });
    return record;
  }

  async function preview(ticketId: string, call: CallOptions): Promise<MergeToMainPreview> {
    const record = await load(ticketId);
    const { repo } = record;
    const worktree = await readWorktreeState(git, record.worktreePath, call);
    const branchRef = `${HEADS}${record.branch}`;
    const baseRef = (await refExists(git, repo, `${HEADS}${record.baseBranch}`, call))
      ? `${HEADS}${record.baseBranch}`
      : (await refExists(git, repo, `${ORIGIN}${record.baseBranch}`, call))
        ? `${ORIGIN}${record.baseBranch}`
        : null;
    const branchExists = await refExists(git, repo, branchRef, call);
    const ahead = baseRef && branchExists ? (await git.aheadBehind(repo, baseRef, branchRef, call)).ahead : null;
    const checkout = await mainCheckout(repo, call);
    return {
      ticketId: record.id,
      source: record.branch,
      target: record.baseBranch,
      checkoutBranch: checkout.branch,
      checkoutClean: checkout.clean,
      repo,
      qaPassed: qaPassed(record),
      worktree,
      ahead,
      alreadyMerged: ahead === 0,
    };
  }

  /** The repo's main checkout (AL-271): the branch it has checked out and whether its tracked files are clean. */
  async function mainCheckout(repo: string, call: CallOptions): Promise<{ branch: string | null; clean: boolean }> {
    try {
      const entries = await git.worktrees(repo, call);
      const main = entries.find((entry) => isSameRepoPath(entry.path, repo)) ?? entries[0];
      const clean = dirtyFiles(await git.status(repo, call), { tracked: true }).length === 0;
      return { branch: main?.branch ?? null, clean };
    } catch {
      return { branch: null, clean: false };
    }
  }

  /** The ticket worktree must be fully committed, QA passed (or waived) and the branch present, whatever the target. */
  async function checkTicketBranch(record: TicketRecord, acceptQaWarning: boolean, target: string, call: CallOptions): Promise<void> {
    const { repo, branch } = record;
    let ticketStatus: GitStatus;
    try {
      ticketStatus = await git.status(record.worktreePath, call);
    } catch (error) {
      if (isGitError(error, 'CWD_NOT_FOUND') || isGitError(error, 'NOT_A_REPO')) {
        refuse('VALIDATION', 'worktree-missing', `The worktree ${record.worktreePath} is missing.`, { worktreePath: record.worktreePath });
      }
      throw error;
    }
    const uncommitted = dirtyFiles(ticketStatus, { tracked: false });
    if (uncommitted.length > 0) {
      refuse('GIT_DIRTY', 'worktree-dirty', `${branch} has uncommitted changes. Commit or discard them before merging into ${target}.`, {
        worktreePath: record.worktreePath,
        ...listed(uncommitted),
      });
    }
    if (!qaPassed(record) && !acceptQaWarning) {
      refuse('VALIDATION', 'qa-not-passed', `QA has not passed for ${record.id}. Confirm again to merge into ${target} anyway.`);
    }
    if (!(await refExists(git, repo, `${HEADS}${branch}`, call))) {
      refuse('VALIDATION', 'branch-missing', `The ticket branch ${branch} no longer exists.`, { branch });
    }
  }

  /** The card moves to Done once the branch is in. */
  async function finishMerge(record: TicketRecord, target: string, targetKind: MergeTarget, mergeCommit: string | null, pushed: boolean): Promise<MergeToMainResult> {
    const mergedAt = now();
    const updated = await tickets.update(record.id, (current) => ({ ...current, stage: 'done' }));
    if (!updated.ok) throw new MergeRefusal(updated);
    await tickets.flush(record.id);
    return { record: updated.data, target, targetKind, mergeCommit, pushed, mergedAt: updated.data.stageHistory.at(-1)?.at ?? mergedAt };
  }

  /**
   * Merge worktree → the main checkout (AL-271, the default): the ticket branch merges into whatever
   * branch the repo's main checkout has checked out, in that checkout, and nothing is pushed.
   */
  async function mergeIntoCheckout(record: TicketRecord, acceptQaWarning: boolean, call: CallOptions): Promise<MergeToMainResult> {
    const { repo, branch } = record;
    const checkout = await mainCheckout(repo, call);
    const target = checkout.branch;
    if (target === null) refuse('VALIDATION', 'checkout-detached', `The main checkout ${repo} has no branch checked out. Check one out, or merge into ${record.baseBranch} instead.`, { repo });
    if (target === branch) refuse('VALIDATION', 'checkout-is-ticket-branch', `The main checkout has the ticket branch ${branch} checked out; there is nothing to merge it into.`, { repo });
    await checkTicketBranch(record, acceptQaWarning, target, call);
    if (!checkout.clean) {
      const files = dirtyFiles(await git.status(repo, call), { tracked: true });
      refuse('GIT_DIRTY', 'base-checkout-dirty', `${repo} has ${target} checked out with uncommitted changes. Commit or stash them first.`, { worktreePath: repo, ...listed(files) });
    }
    let mergeCommit: string | null = null;
    if (!(await isAncestor(git, repo, `${HEADS}${branch}`, 'HEAD', call))) {
      mergeCommit = await mergeInCheckout(repo, record, call, target);
      log.info(`Ticket ${record.id}: merged ${branch} into ${target} in the main checkout (${mergeCommit.slice(0, 12)}).`);
    }
    return finishMerge(record, target, 'checkout', mergeCommit, false);
  }

  async function mergeInRepo(record: TicketRecord, acceptQaWarning: boolean, call: CallOptions): Promise<MergeToMainResult> {
    const { repo, baseBranch: base, branch } = record;
    const baseRef = `${HEADS}${base}`;
    const branchRef = `${HEADS}${branch}`;

    // 1. The ticket worktree must be fully committed.
    await checkTicketBranch(record, acceptQaWarning, base, call);

    // 2. The checkout that has the base checked out, if any, must be clean (untracked files are fine).
    const holder = (await git.worktrees(repo, call)).find((entry) => entry.branchRef === baseRef);
    if (holder) {
      const files = dirtyFiles(await git.status(holder.path, call), { tracked: true });
      if (files.length > 0) {
        refuse('GIT_DIRTY', 'base-checkout-dirty', `${holder.path} has ${base} checked out with uncommitted changes. Commit or stash them first.`, {
          worktreePath: holder.path,
          ...listed(files),
        });
      }
    }

    // 3. Bring the local base up to origin's.
    const hasOrigin = (await git.run(['config', '--get', 'remote.origin.url'], { cwd: repo, allowedExitCodes: [1], ...call })).exitCode === 0;
    if (hasOrigin) {
      const fetchError = await fetchBase(git, repo, base, call);
      if (fetchError !== null) refuse('INTERNAL', 'fetch-failed', `${fetchError} Nothing was merged.`);
    }
    const originRef = `${ORIGIN}${base}`;
    const originExists = hasOrigin && (await refExists(git, repo, originRef, call));
    if (!(await refExists(git, repo, baseRef, call))) {
      if (!originExists) refuse('VALIDATION', 'base-not-found', `The base branch ${base} was not found locally or on origin.`, { baseBranch: base });
      // Not checked out anywhere (it doesn't exist), so the ref can be created directly.
      await git.run(['update-ref', baseRef, await commitOf(git, repo, originRef, call), ''], { cwd: repo, ...call });
    } else if (originExists && !(await isAncestor(git, repo, originRef, baseRef, call))) {
      if (!(await isAncestor(git, repo, baseRef, originRef, call))) {
        refuse('VALIDATION', 'base-diverged', `The local ${base} and origin/${base} have both moved on. Bring ${base} up to date, then merge again.`, {
          baseBranch: base,
        });
      }
      if (holder) await git.run(['merge', '--ff-only', '--quiet', originRef], { cwd: holder.path, ...call });
      else {
        const old = await commitOf(git, repo, baseRef, call);
        await git.run(['update-ref', baseRef, await commitOf(git, repo, originRef, call), old], { cwd: repo, ...call });
      }
    }

    // 4. Merge, unless an earlier attempt already did (its push failed).
    let mergeCommit: string | null = null;
    if (!(await isAncestor(git, repo, branchRef, baseRef, call))) {
      mergeCommit = holder ? await mergeInCheckout(holder.path, record, call) : await mergeWithoutCheckout(repo, record, call);
      log.info(`Ticket ${record.id}: merged ${branch} into ${base} (${mergeCommit.slice(0, 12)}).`);
    }

    // 5. Push the base (never forced).
    if (hasOrigin && !(originExists && (await isAncestor(git, repo, baseRef, originRef, call)))) {
      try {
        await git.run(['push', '--quiet', '--porcelain', 'origin', `${baseRef}:${baseRef}`], { cwd: repo, ...call });
      } catch (error) {
        if (!isGitError(error) || error.code === 'ABORTED') throw error;
        log.warn(`Ticket ${record.id}: pushing ${base} failed: ${error.message}`);
        refuse('INTERNAL', 'push-failed', `${branch} was merged into ${base} locally, but pushing ${base} to origin failed. Merge again to retry the push.`, {
          mergeCommit,
          gitCode: error.code,
          stderr: error.stderr,
        });
      }
    }

    // 6. The card moves to Done.
    return finishMerge(record, base, 'base', mergeCommit, hasOrigin);
  }

  async function mergeInCheckout(checkout: string, record: TicketRecord, call: CallOptions, target: string = record.baseBranch): Promise<string> {
    const result = await git.run(
      ['merge', '--no-ff', '--no-edit', '--quiet', '-m', mergeMessage(record, target), `${HEADS}${record.branch}`],
      { cwd: checkout, allowedExitCodes: [1, 2, 128], ...call },
    );
    if (result.exitCode === 0) return commitOf(git, checkout, 'HEAD', call);

    // A conflict stops with MERGE_HEAD set; anything else (e.g. an untracked file in the way) leaves no merge.
    const status = await git.status(checkout, call);
    const conflicts = status.entries.filter((entry) => entry.kind === 'unmerged').map((entry) => entry.path);
    const inProgress = (await git.run(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: checkout, allowedExitCodes: [1], ...call })).exitCode === 0;
    if (inProgress) await git.run(['merge', '--abort'], { cwd: checkout });
    if (conflicts.length > 0) {
      refuse('MERGE_CONFLICT', 'conflict', `Merging ${record.branch} into ${record.baseBranch} conflicts in ${conflicts.length} file(s). Nothing was merged.`, listed(conflicts));
    }
    const reason = result.stderr.split(/\r?\n/).find((line) => line.trim() !== '') ?? `git merge exited with ${result.exitCode}`;
    refuse('INTERNAL', 'git-failed', `Merging ${record.branch} into ${record.baseBranch} failed: ${reason.trim()}`, { exitCode: result.exitCode });
  }

  async function mergeWithoutCheckout(repo: string, record: TicketRecord, call: CallOptions): Promise<string> {
    const baseRef = `${HEADS}${record.baseBranch}`;
    const base = await commitOf(git, repo, baseRef, call);
    const head = await commitOf(git, repo, `${HEADS}${record.branch}`, call);
    const tree = await git.run(['merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', base, head], {
      cwd: repo,
      allowedExitCodes: [1],
      ...call,
    });
    const [treeId = '', ...rest] = tree.stdout.split('\0');
    if (tree.exitCode === 1) {
      const conflicts = [...new Set(rest.filter((name) => name !== ''))];
      refuse('MERGE_CONFLICT', 'conflict', `Merging ${record.branch} into ${record.baseBranch} conflicts in ${conflicts.length} file(s). Nothing was merged.`, listed(conflicts));
    }
    const commit = (await git.run(['commit-tree', treeId.trim(), '-p', base, '-p', head, '-m', mergeMessage(record)], { cwd: repo, ...call })).stdout.trim();
    await git.run(['update-ref', '-m', `merge ${record.branch}`, baseRef, commit, base], { cwd: repo, ...call });
    return commit;
  }

  async function guarded<T>(task: () => Promise<T>): Promise<Result<T>> {
    try {
      return ok(await task());
    } catch (error) {
      if (error instanceof MergeRefusal) return error.result;
      if (isGitError(error, 'ABORTED')) return err('INTERNAL', 'The merge was cancelled.', { reason: 'aborted' });
      if (isGitError(error)) return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode });
      throw error;
    }
  }

  return {
    preview: (ticketId, call = {}) => guarded(() => preview(ticketId, call)),
    merge: (ticketId, { acceptQaWarning = false, target = 'checkout', ...call } = {}) =>
      guarded(async () => {
        const record = await load(ticketId);
        await git.ensureSupported(call);
        return inRepo(repoPathKey(record.repo), async () => {
          // Read again inside the queue: an earlier merge in this repo may have changed it.
          const current = await load(ticketId);
          if (!isSameRepoPath(current.repo, record.repo)) refuse('VALIDATION', 'ticket-not-found', `There is no ticket ${ticketId}.`);
          return target === 'base' ? mergeInRepo(current, acceptQaWarning, call) : mergeIntoCheckout(current, acceptQaWarning, call);
        });
      }),
  };
}
