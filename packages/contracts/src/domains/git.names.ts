/** Worktrees, branch status, merges, diff and archive (AL-083–AL-090). Zod-free: imported by the sandboxed preload. */
export const GIT_INVOKE_CHANNELS = [
  // Ticket branch vs base and each sub-branch vs the ticket branch (AL-085).
  'branches:status',
  // Merge worktree → main: what the confirm modal shows, then the merge and push (AL-087).
  'git:mergeToMainPreview',
  'git:mergeToMain',
  // Files changed against the base or a sub-branch, and one file's unified diff on demand (AL-089).
  'git:diff',
  'git:diffFile',
  // Merge sub-branches → ticket branch, and the two ways out of a conflict (AL-086).
  'git:mergeSubBranches',
  'git:handConflictToLead',
  'git:openConflictFiles',
] as const;
export const GIT_EVENT_CHANNELS = [] as const;
