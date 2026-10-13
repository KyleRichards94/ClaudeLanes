import type { CHANGES_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The changes domain's channels (AL-276, AL-277): the ticket's changed files with authors, and the reviewer's findings. */
export function createChangesHandlers({ changes }: Pick<Services, 'changes'>): HandlersFor<(typeof CHANGES_INVOKE_CHANNELS)[number]> {
  return {
    'diff:files': ({ ticketId }) => changes.files(ticketId),
    'review:findings': ({ ticketId }) => changes.findings(ticketId),
  };
}
