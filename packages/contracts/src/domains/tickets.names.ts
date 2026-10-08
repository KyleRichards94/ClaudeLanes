/** Agent ticket records, launch and start-up reconciliation (AL-090, AL-101, AL-165). Zod-free: imported by the sandboxed preload. */
export const TICKETS_INVOKE_CHANNELS = [
  // Ticket records for the board (AL-143).
  'tickets:list',
  // Archive: remove the ticket's worktrees and move its record to the archive list (AL-088).
  'tickets:archive',
  'tickets:archived',
  // Start-up reconciliation: the board from records and git's worktrees, and what to do with orphans (AL-090).
  'tickets:board',
  'tickets:adoptWorktree',
  'tickets:ignoreWorktree',
  // One ticket's record for the drill-in and the design tab (AL-170).
  'tickets:get',
  // Launch from the New agent ticket modal: worktree, record, then the session or the Queued lane (AL-165).
  'tickets:launch',
] as const;
export const TICKETS_EVENT_CHANNELS = [] as const;
