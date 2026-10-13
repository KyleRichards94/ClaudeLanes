import type { BranchStatus, SubBranchStatus } from '@agent-lanes/contracts';import type { AgentTicket } from '@/entities/agent-ticket';

export type MergePanelTicket = Pick<AgentTicket, 'branch' | 'baseBranch' | 'stage'>;

/** One of the Merge panel's two buttons: its label, and why it is off (null when it works). */
export interface MergeAction {
  label: string;
  disabledReason: string | null;
  /** Said under an enabled button, e.g. that uncommitted changes will be committed first. */
  note?: string;
}

/**
 * What the Merge panel shows (AL-174, artboard 3, design §9 steps 4–5, R9): "Merge 3 sub-branches →
 * 71273-cutover-job-control" and the dark "Merge worktree → main", each off with a reason when
 * nothing is ready or the worktree can't be merged, and whether a merge is stopped on conflicts.
 */
export interface MergePanel {
  subBranches: MergeAction;
  toMain: MergeAction;
  /** A sub-branch merge stopped on conflicts in the ticket worktree and is still unresolved. */
  conflicted: boolean;
  /** The sub-branches Merge sub-branches would merge now. */
  readyCount: number;
}

export type BranchStatusState = { status: 'pending' } | { status: 'error' } | { status: 'success'; data: BranchStatus };

export interface MergePanelOptions {
  /** The agent is in a turn (AL-254): merging the worktree now would race its edits, so Merge → main waits. */
  agentBusy?: boolean;
}

export const AGENT_BUSY_REASON = 'The agent is mid-turn. Wait for it to finish, or stop it first.';

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Merge sub-branches" with none to merge, else "Merge 3 sub-branches"; the target branch is shown under the button (AL-254). */
export function subBranchesLabel(count: number): string {
  return count === 0 ? 'Merge sub-branches' : `Merge ${plural(count, 'sub-branch', 'sub-branches')}`;
}

/** Ready (clean, its sub-agent finished), not merged yet, and with commits the ticket branch lacks. */
export function isMergeable(sub: SubBranchStatus): boolean {
  return sub.ready && sub.mergedAt === null && (sub.ahead ?? 0) > 0;
}

export function mergePanel(ticket: MergePanelTicket, state: BranchStatusState, options: MergePanelOptions = {}): MergePanel {
  const subs = state.status === 'success' ? state.data.subBranches : [];
  const unmerged = subs.filter((sub) => sub.mergedAt === null);
  const readyCount = subs.filter(isMergeable).length;
  const shown = readyCount > 0 ? readyCount : unmerged.length;
  const subLabel = subBranchesLabel(shown);
  // AL-271: the default target is the main checkout's branch; the modal names it and offers the base branch too.
  const mainLabel = 'Merge worktree → main checkout';

  const toMain: MergeAction = { label: mainLabel, disabledReason: mainReason(ticket, state, options) };
  if (toMain.disabledReason === null && state.status === 'success' && state.data.ticket.dirty) {
    const files = state.data.ticket.changedFiles;
    toMain.note = `${files ? plural(files, 'uncommitted change') : 'Uncommitted changes'} will be committed first.`;
  }

  const shared = sharedReason(ticket, state);
  if (shared !== null || state.status !== 'success') {
    return {
      subBranches: { label: subLabel, disabledReason: shared ?? 'Checking the branches…' },
      toMain,
      conflicted: state.status === 'success' && state.data.ticket.conflicted,
      readyCount,
    };
  }

  return {
    subBranches: { label: subLabel, disabledReason: readyCount > 0 ? null : nothingReadyReason(subs, unmerged) },
    toMain,
    conflicted: false,
    readyCount,
  };
}

/**
 * Merge worktree → main is on unless it truly can't run: the ticket is done, the worktree is gone or
 * stopped on conflicts, or the agent is mid-turn. Uncommitted changes don't stop it (the modal commits
 * them first), and with nothing new on the branch it still moves the card to Done.
 */
function mainReason(ticket: MergePanelTicket, state: BranchStatusState, options: MergePanelOptions): string | null {
  if (ticket.stage === 'done') return 'The ticket is done.';
  if (state.status === 'success') {
    if (!state.data.ticket.present) return 'The worktree is missing.';
    if (state.data.ticket.conflicted) return 'A merge is stopped on conflicts.';
  }
  return options.agentBusy ? AGENT_BUSY_REASON : null;
}

/** Reasons that stop both merges: the ticket is done, the status is unknown, the worktree can't be merged. */
function sharedReason(ticket: MergePanelTicket, state: BranchStatusState): string | null {
  if (ticket.stage === 'done') return 'The ticket is done.';
  if (state.status === 'pending') return null;
  if (state.status === 'error') return "Couldn't read the branches.";
  const worktree = state.data.ticket;
  if (!worktree.present) return 'The worktree is missing.';
  if (worktree.conflicted) return 'A merge is stopped on conflicts.';
  if (worktree.dirty) {
    const files = worktree.changedFiles;
    return files ? `The worktree has ${plural(files, 'uncommitted change')}.` : 'The worktree has uncommitted changes.';
  }
  return null;
}

function nothingReadyReason(subs: readonly SubBranchStatus[], unmerged: readonly SubBranchStatus[]): string {
  if (subs.length === 0) return 'No sub-branches yet.';
  if (unmerged.length === 0) return 'Every sub-branch is merged.';
  const running = unmerged.filter((sub) => !sub.finished).length;
  if (running > 0) return `${plural(running, 'sub-agent')} still ${running === 1 ? 'runs' : 'run'}.`;
  const dirty = unmerged.filter((sub) => sub.dirty === true || !sub.present).length;
  if (dirty > 0) return `${plural(dirty, 'sub-branch', 'sub-branches')} ${dirty === 1 ? 'has' : 'have'} uncommitted changes.`;
  return 'Nothing new on the sub-branches.';
}
