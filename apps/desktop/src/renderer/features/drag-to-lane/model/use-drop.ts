import type { Lane, TeamBoard, TeamBoardItem } from '@agent-lanes/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { allowedLanes, type DropAction } from '@/entities/agent-ticket';
import { toast } from '@/shared/model';
import { clearPendingLane, setPendingLane } from './drag-store';
import { dragMembers } from './lane-state';
import type { LaneDragCard, LaunchFromLane } from './types';

/** The team board's ADO queries (TB§6): a drop updates them optimistically and refetches them once main answers. */
export const DROP_QUERY_KEYS = [
  ['ado', 'teamBoard'],
  ['ado', 'activePrs'],
  ['ado', 'backlog'],
] as const;

/** "KR" for Kyle Richards: first and last word, as the board's avatars show people. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * The board as it will be once main has made a To Do or Failed drop's one ADO change (T5): the item
 * assigned to you and in the board's In Progress column. Other items and boards are returned as they are.
 */
export function withItemInProgress(board: TeamBoard, itemId: number, meName: string | null): TeamBoard {
  const column = board.columns.find((candidate) => candidate.kind === 'in-progress');
  if (!board.items.some((item) => item.id === itemId)) return board;
  return {
    ...board,
    items: board.items.map((item): TeamBoardItem => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        ...(column
          ? {
              columnId: column.id,
              column: column.name,
              columnKind: column.kind,
            }
          : {}),
        assignee: meName
          ? {
              id: null,
              displayName: meName,
              uniqueName: null,
              initials: initialsOf(meName),
            }
          : item.assignee,
      };
    }),
  };
}

/**
 * Moves the card on every cached team board as the drop will (only a drop that changes ADO moves it).
 * Returns the rollback, which puts the cached boards back as they were.
 */
export function updateBoardsOptimistically(queryClient: QueryClient, card: LaneDragCard, action: DropAction): () => void {
  if (card.card.kind !== 'board-item' || !action.changesAdo) return () => {};
  const itemId = card.card.id;
  const snapshot = queryClient.getQueriesData<TeamBoard>({
    queryKey: DROP_QUERY_KEYS[0],
  });
  queryClient.setQueriesData<TeamBoard>({ queryKey: DROP_QUERY_KEYS[0] }, (board) => (board ? withItemInProgress(board, itemId, card.meName) : board));
  return () => {
    for (const [queryKey, data] of snapshot) queryClient.setQueryData(queryKey, data);
  };
}

/** Without a launch (AL-236 not in this build) a drop says so and changes nothing. */
async function launchUnavailable(): Promise<null> {
  toast({
    id: 'drag-to-lane',
    tone: 'info',
    title: "Agents can't start from the team board yet",
    body: 'This build has no launch for team board drops. Nothing changed in Azure DevOps.',
  });
  return null;
}

export type DropOnLane = (card: LaneDragCard, lane: Lane, options?: { alt?: boolean }) => Promise<boolean>;

/**
 * Drops a card on a lane (a pointer or keyboard drag, or the "Send to lane" menu): rechecks the drop
 * rules, updates the board optimistically (the item shows "Agent in <lane>" and, for a To Do or Failed
 * item, moves to In Progress assigned to you), then hands the drop to the launch (AL-236). When main
 * confirms, the team board's queries are refetched; when it refuses or fails, the optimistic change is
 * rolled back first. Resolves true when the launch was confirmed.
 *
 * A group (the Backlog popout's selection, TB§5) starts one agent per card, one after another, so
 * main puts those over the agent limit in Queued; every card shows "Agent in <lane>" at once. Alt
 * opens the launch sheet for a single card only. Resolves true when any launch was confirmed.
 */
export function useDropOnLane(onLaunch?: LaunchFromLane): DropOnLane {
  const queryClient = useQueryClient();
  return useCallback<DropOnLane>(
    async (card, lane, options = {}) => {
      const members = dragMembers(card);
      if (members.length <= 1) return dropCard(queryClient, onLaunch, card, lane, options.alt === true);
      for (const member of members) {
        if (member.card.kind !== 'pull-request' && allowedLanes(member.card, member.me)[lane]) setPendingLane(member.card.id, lane);
      }
      let confirmed = false;
      for (const member of members) confirmed = (await dropCard(queryClient, onLaunch, member, lane, false)) || confirmed;
      return confirmed;
    },
    [onLaunch, queryClient],
  );
}

/** One card's drop: the optimistic update, the launch, and the rollback when main did not confirm it. */
async function dropCard(queryClient: QueryClient, onLaunch: LaunchFromLane | undefined, card: LaneDragCard, lane: Lane, alt: boolean): Promise<boolean> {
  const action = allowedLanes(card.card, card.me)[lane];
  if (!action) return false;
  const itemId = card.card.kind === 'pull-request' ? null : card.card.id;

  // A refetch already on its way would overwrite the optimistic board.
  await queryClient.cancelQueries({ queryKey: DROP_QUERY_KEYS[0] });
  const rollback = updateBoardsOptimistically(queryClient, card, action);
  if (itemId !== null) setPendingLane(itemId, lane);

  let confirmed = false;
  try {
    const result = onLaunch ? await onLaunch({ source: card.source, lane }, { alt, action }) : await launchUnavailable();
    confirmed = result !== null && result !== undefined;
  } catch {
    confirmed = false;
  } finally {
    if (!confirmed) rollback();
    if (itemId !== null) clearPendingLane(itemId);
    for (const queryKey of DROP_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey });
  }
  return confirmed;
}
