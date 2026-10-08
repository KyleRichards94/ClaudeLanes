/** The Create PR stage for one ticket: draft, create, watch until merged or abandoned (AL-181). Zod-free: imported by the sandboxed preload. */
export const PR_INVOKE_CHANNELS = [
  // The title and description drafted from the agent's summary, and where the PR would go.
  'pr:draft',
  // Pushes the ticket branch, creates the PR linked to the work item, and records it on the ticket.
  'pr:create',
  // The ticket's PR and its checks, read again from ADO; a completed or abandoned PR moves the ticket to Done.
  'pr:get',
] as const;
export const PR_EVENT_CHANNELS = [
  // The ticket's PR was created or its status or checks changed (the card's "PR !10612 · 3 / 4 checks").
  'pr:status',
] as const;
