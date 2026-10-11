import { existsSync } from 'node:fs';
import { err, ok, type Result } from '@agent-lanes/contracts';
import type { TicketRecordStore } from '../tickets';

/**
 * Open worktree folder (AL-267): shows the ticket's worktree in the OS file manager through Electron's
 * `shell.openPath`, which answers '' on success or the OS's reason. A worktree that is gone is refused
 * before the OS is asked.
 */
export interface WorktreeOpener {
  open(ticketId: string): Promise<Result<{ path: string }>>;
}

export interface WorktreeOpenerOptions {
  tickets: Pick<TicketRecordStore, 'get'>;
  /** `shell.openPath`; resolves to '' when the folder opened, else the OS's message. */
  openPath: (path: string) => Promise<string>;
  exists?: (path: string) => boolean;
}

export function createWorktreeOpener(options: WorktreeOpenerOptions): WorktreeOpener {
  const exists = options.exists ?? existsSync;
  return {
    async open(ticketId) {
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      if (!exists(record.worktreePath)) return err('VALIDATION', `The worktree ${record.worktreePath} is missing.`, { reason: 'worktree-missing', worktreePath: record.worktreePath });
      const failure = await options.openPath(record.worktreePath);
      if (failure) return err('INTERNAL', `The folder could not be opened: ${failure}`);
      return ok({ path: record.worktreePath });
    },
  };
}
