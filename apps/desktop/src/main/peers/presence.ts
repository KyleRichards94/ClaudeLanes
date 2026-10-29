import { PEER_FILES_MAX, type PeerLane, type RoomMember, type TicketRecord } from '@agent-lanes/contracts';
import type { DiffService } from '../worktrees/diff';
import type { PeerIdentity } from './network';

/**
 * This app's side of presence (AL-290, P3): what each of its lanes is, and the files it has touched.
 */

/** A lane on the board that peers hear about: not a second agent, not finished. */
export function isLiveLane(record: TicketRecord): boolean {
  return !record.companion && record.stage !== 'done';
}

export function laneOf(record: TicketRecord): PeerLane {
  return {
    ticketId: record.id,
    workItemId: record.ado?.workItemId ?? null,
    title: record.title.slice(0, 1_000),
    stage: record.stage,
    branch: record.branch,
    parentId: record.room?.parentId ?? null,
  };
}

/** Worktree-relative paths changed against the base and on every sub-branch (PL§9: sub-branches count). */
export async function touchedFiles(record: TicketRecord, diffs: Pick<DiffService, 'files'>): Promise<string[]> {
  const against = [{ kind: 'base' as const }, ...record.subBranches.map((sub) => ({ kind: 'sub-branch' as const, branch: sub.branch }))];
  const paths = new Set<string>();
  for (const one of against) {
    const diff = await diffs.files(record.id, one);
    if (diff.ok) for (const file of diff.data.files) paths.add(file.path);
  }
  return [...paths].sort().slice(0, PEER_FILES_MAX);
}

export function localMember(me: PeerIdentity, lane: PeerLane, touched: readonly string[], at: number): RoomMember {
  return { instance: me.instance, user: me.user, host: me.host, lane, touched: [...touched], lastSeenAt: at, local: true, reachable: true };
}
