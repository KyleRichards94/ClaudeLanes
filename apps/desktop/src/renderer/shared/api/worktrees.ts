import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { WorktreePreview, WorktreePreviewRequest } from '@agent-lanes/contracts';
import { invoke, unwrap } from './ipc';

export function worktreePreviewQueryKey(request: WorktreePreviewRequest) {
  return ['worktree-preview', request] as const;
}

async function previewWorktree(request: WorktreePreviewRequest): Promise<WorktreePreview> {
  return unwrap(await invoke('git:previewWorktree', request));
}

/**
 * The ticket's branch and worktree as launch would name them, and why an edited branch name would be
 * refused (AL-164). Keeps showing the last answer while the next one loads, so the row doesn't flicker
 * as the user types. Null while there is no repo to preview in.
 */
export function useWorktreePreview(request: WorktreePreviewRequest | null) {
  return useQuery({
    queryKey: request ? worktreePreviewQueryKey(request) : ['worktree-preview', null],
    queryFn: () => (request ? previewWorktree(request) : Promise.reject(new Error('No repo to preview the worktree in.'))),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    // Branches change outside the app; a preview is good for a few seconds.
    staleTime: 5_000,
    retry: false,
  });
}

/** A fresh preview for exactly this request, for Launch to check the name the user sees now. */
export function fetchWorktreePreview(queryClient: QueryClient, request: WorktreePreviewRequest): Promise<WorktreePreview> {
  return queryClient.fetchQuery({ queryKey: worktreePreviewQueryKey(request), queryFn: () => previewWorktree(request), staleTime: 0, retry: false });
}
