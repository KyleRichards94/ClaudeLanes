/** Build and run jobs per worktree (AL-130–AL-135). Zod-free: imported by the sandboxed preload. */
export const BUILD_INVOKE_CHANNELS = [
  'build:listJobs',
  'build:cancel',
  'build:commands',
  'build:start',
  'run:start',
  'run:list',
  'run:openUrl',
  'run:stop',
] as const;
export const BUILD_EVENT_CHANNELS = [
  'build:log',
  'run:status',
  'build:queued',
  'build:finished',
] as const;
