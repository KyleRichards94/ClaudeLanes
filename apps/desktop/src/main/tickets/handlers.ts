import { ok, type TICKETS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The tickets domain's channels: archive (AL-088) and start-up reconciliation (AL-090). */
export function createTicketsHandlers({
  archive,
  ticketArchive,
  reconcile,
}: Pick<Services, 'archive' | 'ticketArchive' | 'reconcile'>): HandlersFor<(typeof TICKETS_INVOKE_CHANNELS)[number]> {
  return {
    'tickets:archive': ({ ticketId, discardUnmerged, deleteMergedBranches }) => archive.archive(ticketId, { discardUnmerged, deleteMergedBranches }),
    'tickets:archived': async () => ok(await ticketArchive.list()),
    'tickets:board': () => reconcile.board(),
    'tickets:adoptWorktree': ({ worktreePath }) => reconcile.adopt(worktreePath),
    'tickets:ignoreWorktree': ({ worktreePath }) => reconcile.ignore(worktreePath),
  };
}
