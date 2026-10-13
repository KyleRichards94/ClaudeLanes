/** The ticket's changed files with their authors, and the reviewer's findings (AL-276, AL-277). Zod-free: imported by the sandboxed preload. */
export const CHANGES_INVOKE_CHANNELS = [
  // Every file the ticket changed against its base, with line counts, author agent and review status (AL-276).
  'diff:files',
  // The reviewer's findings, parsed from its structured output (AL-277).
  'review:findings',
] as const;
export const CHANGES_EVENT_CHANNELS = [] as const;
