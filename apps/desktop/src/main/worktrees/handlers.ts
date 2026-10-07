import type { GIT_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The git domain's channels (AL-085–AL-089): branch status, merges, diff and archive. */
export function createGitHandlers({ branches }: Pick<Services, 'branches'>): HandlersFor<(typeof GIT_INVOKE_CHANNELS)[number]> {
  return {
    'branches:status': ({ ticketId }) => branches.status(ticketId),
  };
}
