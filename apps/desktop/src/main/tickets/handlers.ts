import { ok, type TICKETS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The tickets domain's channels: archive (AL-088) and start-up reconciliation (AL-090). */
export function createTicketsHandlers({
  archive,
  ticketArchive,
}: Pick<Services, 'archive' | 'ticketArchive'>): HandlersFor<(typeof TICKETS_INVOKE_CHANNELS)[number]> {
  return {
    'tickets:archive': ({ ticketId, discardUnmerged, deleteMergedBranches }) => archive.archive(ticketId, { discardUnmerged, deleteMergedBranches }),
    'tickets:archived': async () => ok(await ticketArchive.list()),
  };
}
