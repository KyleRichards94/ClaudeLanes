import type { GIT_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The `git:*` channels. Git itself has no channel (main-only); these go through the services that use it. */
export function createGitHandlers({ worktrees }: Pick<Services, 'worktrees'>): HandlersFor<(typeof GIT_INVOKE_CHANNELS)[number]> {
  return {
    'git:previewWorktree': (request) => worktrees.preview(request),
  };
}
