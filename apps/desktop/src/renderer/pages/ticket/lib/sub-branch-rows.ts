import type { SubBranchStatus, TicketSubBranch } from '@agent-lanes/contracts';
import type { PillTone } from '@agent-lanes/ui';

/** One row of the Sub-branches panel (AL-178, artboard 3): "sub/71273-filter  4 ahead  Ready". */
export interface SubBranchRow {
  branch: string;
  /** "4 ahead"; null when not known yet or nothing is ahead. */
  ahead: string | null;
  state: { label: string; tone: PillTone } | null;
}

/**
 * Rows from the live branch status (`branches:status`), which is read again after every merge and
 * when a sub-agent starts or finishes. Before it arrives, the record's sub-branches are listed with
 * only Merged known.
 */
export function subBranchRows(status: readonly SubBranchStatus[] | undefined, recorded: readonly TicketSubBranch[]): readonly SubBranchRow[] {
  if (!status) {
    return recorded.map((sub) => ({ branch: sub.branch, ahead: null, state: sub.mergedAt !== null ? { label: 'Merged', tone: 'ok' } : null }));
  }
  return status.map((sub) => ({
    branch: sub.branch,
    ahead: sub.ahead !== null && sub.ahead > 0 ? `${sub.ahead} ahead` : null,
    state: stateOf(sub),
  }));
}

function stateOf(sub: SubBranchStatus): SubBranchRow['state'] {
  if (sub.mergedAt !== null && (sub.ahead ?? 0) === 0) return { label: 'Merged', tone: 'ok' };
  if (!sub.present) return { label: 'Missing', tone: 'danger' };
  if (sub.conflicted) return { label: 'Conflict', tone: 'attention' };
  if (!sub.finished) return { label: 'Working', tone: 'claude' };
  if (sub.dirty) return { label: 'Uncommitted', tone: 'attention' };
  if (sub.ready && (sub.ahead ?? 0) > 0) return { label: 'Ready', tone: 'ado' };
  return { label: 'Nothing new', tone: 'neutral' };
}
