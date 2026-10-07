/** Agent ticket records, launch and start-up reconciliation (AL-090, AL-101, AL-165). Zod-free: imported by the sandboxed preload. */
export const TICKETS_INVOKE_CHANNELS = [
  // Archive: remove the ticket's worktrees and move its record to the archive list (AL-088).
  'tickets:archive',
  'tickets:archived',
] as const;
export const TICKETS_EVENT_CHANNELS = [] as const;
