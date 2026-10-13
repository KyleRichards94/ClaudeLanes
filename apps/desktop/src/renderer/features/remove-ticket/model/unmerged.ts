import type { UnmergedWork } from '@agent-lanes/contracts';
import { IpcError } from '@/shared/api';

/** Unmerged work the archive refused over, from the VALIDATION `unmerged-work` details (AL-088). */
export function unmergedOf(error: unknown): UnmergedWork | null {
  if (!(error instanceof IpcError) || error.code !== 'VALIDATION') return null;
  const details = error.details as { reason?: unknown; branches?: unknown; dirtyWorktrees?: unknown } | undefined;
  if (details?.reason !== 'unmerged-work') return null;
  return {
    branches: Array.isArray(details.branches) ? (details.branches as UnmergedWork['branches']) : [],
    dirtyWorktrees: Array.isArray(details.dirtyWorktrees) ? (details.dirtyWorktrees as string[]) : [],
  };
}
