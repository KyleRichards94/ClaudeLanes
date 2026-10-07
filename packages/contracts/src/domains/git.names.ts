/** Worktrees, branch status, merges, diff and archive (AL-083–AL-090). Zod-free: imported by the sandboxed preload. */
export const GIT_INVOKE_CHANNELS = [
  // Ticket branch vs base and each sub-branch vs the ticket branch (AL-085).
  'branches:status',
  // Merge worktree → main: what the confirm modal shows, then the merge and push (AL-087).
  'git:mergeToMainPreview',
  'git:mergeToMain',
] as const;
export const GIT_EVENT_CHANNELS = [] as const;
