import { ok, type TICKETS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The tickets domain's channels: records for the board (AL-143) and drill-in (AL-170), archive (AL-088) and start-up reconciliation (AL-090). Launch (AL-165) adds its channels here. */
export function createTicketsHandlers({
  tickets,
  archive,
  ticketArchive,
  reconcile,
  ticketLauncher,
}: Pick<Services, 'tickets' | 'archive' | 'ticketArchive' | 'reconcile' | 'ticketLauncher'>): HandlersFor<(typeof TICKETS_INVOKE_CHANNELS)[number]> {
  return {
    'tickets:list': async () => ok(await tickets.list()),
    'tickets:archive': ({ ticketId, discardUnmerged, deleteMergedBranches }) => archive.archive(ticketId, { discardUnmerged, deleteMergedBranches }),
    'tickets:archived': async () => ok(await ticketArchive.list()),
    'tickets:board': () => reconcile.board(),
    'tickets:adoptWorktree': ({ worktreePath }) => reconcile.adopt(worktreePath),
    'tickets:ignoreWorktree': ({ worktreePath }) => reconcile.ignore(worktreePath),
    'tickets:get': async ({ ticketId }) => ok({ record: (await tickets.get(ticketId)) ?? null }),
    'tickets:launch': (request) => ticketLauncher.launch(request),
  };
}
