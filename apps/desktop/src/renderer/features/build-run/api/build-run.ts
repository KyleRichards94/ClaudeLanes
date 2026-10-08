import { useMutation } from '@tanstack/react-query';
import type { Result } from '@agent-lanes/contracts';
import { invoke } from '@/shared/api';
import { toast } from '@/shared/model';

/**
 * Build / Run / Stop for a ticket's worktree (AL-173) over AL-132–AL-134's channels. The buttons'
 * states come from events in the agent ticket store, not from these calls, so a build the agent
 * started looks the same as one started here. A call only raises a toast when it was refused for a
 * reason the panel can't show itself (no build command, worktree missing); a failed build is shown
 * by the panel ("Last build 14:02 · failed · 3 errors") and the Build log tab.
 */

type Action = 'build' | 'run' | 'stop' | 'cancel' | 'open';

const FAILURE_TITLES: Record<Action, string> = {
  build: "Couldn't start the build",
  run: "Couldn't run the app",
  stop: "Couldn't stop the app",
  cancel: "Couldn't cancel the build",
  open: "Couldn't open the app",
};

function reportFailure(action: Action, ticketId: string, result: Result<unknown>): void {
  if (result.ok || result.code === 'BUILD_FAILED') return;
  toast({ id: `build-run:${action}:${ticketId}`, tone: 'error', title: FAILURE_TITLES[action], body: result.message });
}

async function call(action: Action, ticketId: string, run: () => Promise<Result<unknown>>): Promise<void> {
  try {
    reportFailure(action, ticketId, await run());
  } catch (cause) {
    toast({ id: `build-run:${action}:${ticketId}`, tone: 'error', title: FAILURE_TITLES[action], body: cause instanceof Error ? cause.message : undefined });
  }
}

/** The ticket's Build, Run, Stop, cancel-a-queued-build and open-the-running-app actions. */
export function useBuildRunActions(ticketId: string) {
  const build = useMutation({ mutationFn: () => call('build', ticketId, () => invoke('build:start', { ticketId })) });
  const run = useMutation({ mutationFn: () => call('run', ticketId, () => invoke('run:start', { ticketId })) });
  const stop = useMutation({ mutationFn: () => call('stop', ticketId, () => invoke('run:stop', { ticketId })) });
  const cancel = useMutation({ mutationFn: (jobId: string) => call('cancel', ticketId, () => invoke('build:cancel', { jobId })) });
  const open = useMutation({ mutationFn: () => call('open', ticketId, () => invoke('run:openUrl', { ticketId })) });
  return { build, run, stop, cancel, open };
}
