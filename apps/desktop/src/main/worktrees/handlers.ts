import type { GIT_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The git domain's channels (AL-085–AL-089, AL-164): branch status, merges, diff, archive and the worktree preview. */
export function createGitHandlers({
  branches,
  mergeToMain,
  diffs,
  mergeSubBranches,
  worktrees,
}: Pick<Services, 'branches' | 'mergeToMain' | 'diffs' | 'mergeSubBranches' | 'worktrees'>): HandlersFor<(typeof GIT_INVOKE_CHANNELS)[number]> {
  return {
    'branches:status': ({ ticketId }) => branches.status(ticketId),
    'git:mergeToMainPreview': ({ ticketId }) => mergeToMain.preview(ticketId),
    'git:mergeToMain': ({ ticketId, acceptQaWarning }) => mergeToMain.merge(ticketId, { acceptQaWarning }),
    'git:diff': ({ ticketId, against }) => diffs.files(ticketId, against),
    'git:diffFile': ({ ticketId, against, path, oldPath }) => diffs.file(ticketId, against, path, oldPath),
    'git:mergeSubBranches': ({ ticketId }) => mergeSubBranches.merge(ticketId),
    'git:handConflictToLead': ({ ticketId }) => mergeSubBranches.handToLead(ticketId),
    'git:openConflictFiles': ({ ticketId }) => mergeSubBranches.openConflictFiles(ticketId),
    'git:previewWorktree': (request) => worktrees.preview(request),
  };
}
