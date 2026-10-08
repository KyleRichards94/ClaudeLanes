import { useQuery } from '@tanstack/react-query';
import type { DiffAgainst } from '@agent-lanes/contracts';
import { branchesQueryKey } from './branches';
import { invoke, unwrap } from './ipc';

function againstKey(against: DiffAgainst): string {
  return against.kind === 'base' ? 'base' : `sub:${against.branch}`;
}

/** Under `['branches', ticketId]`, so a merge or a sub-agent's commits refresh the Diff tab too. */
export function diffQueryKey(ticketId: string, against: DiffAgainst) {
  return [...branchesQueryKey(ticketId), 'diff', againstKey(against)] as const;
}

export function diffFileQueryKey(ticketId: string, against: DiffAgainst, path: string, oldPath?: string) {
  return [...diffQueryKey(ticketId, against), 'file', path, oldPath ?? null] as const;
}

/**
 * The Diff tab's file list: status and line counts against the base or a sub-branch (AL-089, AL-179).
 * The Merge panel's conflict view reads the unmerged files from it only while a merge is stopped (AL-174).
 */
export function useTicketDiff(ticketId: string, against: DiffAgainst, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: diffQueryKey(ticketId, against),
    queryFn: async () => unwrap(await invoke('git:diff', { ticketId, against })),
    enabled: options.enabled,
  });
}

/**
 * One file's unified diff, loaded when the file is opened. Binary and very large files come back
 * as `binary` / `too-large` placeholders instead of content.
 */
export function useDiffFile(ticketId: string, against: DiffAgainst, file: { path: string; oldPath?: string | null } | null) {
  const oldPath = file?.oldPath ?? undefined;
  return useQuery({
    queryKey: diffFileQueryKey(ticketId, against, file?.path ?? '', oldPath),
    queryFn: async () => unwrap(await invoke('git:diffFile', { ticketId, against, path: file?.path ?? '', ...(oldPath ? { oldPath } : {}) })),
    enabled: file !== null,
  });
}
