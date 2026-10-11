import { useMutation } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

/** Open worktree folder (AL-267): shows the ticket's worktree in the OS file manager. */
export function useOpenWorktree(ticketId: string) {
  return useMutation({ mutationFn: async () => unwrap(await invoke('git:openWorktree', { ticketId })) });
}
