import type { Lane } from '@agent-lanes/contracts';
import type { DropAction, DropCard, DropMe } from '@/entities/agent-ticket';

/**
 * What a drop sends to the launch (AL-236's `agent:launchFromAdo` `source`): the card as the board
 * showed it, so main can read it again from Azure DevOps and recheck the drop rules before acting.
 */
export type LaneDropSource =
  | {
      kind: 'board-item';
      id: number;
      /** The team board's team id and sprint (iteration path): main reads that board again. */
      team: string;
      sprint: string;
      /** The column the card was in, so a refusal can say where it moved ("Moved to Testing — refreshed"). */
      column?: string;
    }
  | { kind: 'backlog-item'; id: number }
  | { kind: 'pull-request'; id: number; team?: string };

/** A card that can be dragged onto an agent lane, or sent to one from the keyboard menu. */
export interface LaneDragCard {
  /** Unique on the page: `item:71318`, `pr:10571`, `backlog:71400`. */
  key: string;
  /** `#71318` or `!10571`. */
  label: string;
  title: string;
  /** The card for the drop rules (AL-230). */
  card: DropCard;
  /** The signed-in user as the drop rules know them. */
  me: DropMe;
  /** The signed-in user's display name, for the optimistic "assigned to you" (T5). */
  meName: string | null;
  source: LaneDropSource;
  /**
   * Every card dragged together with this one, this one included (the Backlog popout's shift-click
   * selection, TB§5): a drop starts one agent per card. Left out, or one card, for a single drag.
   */
  group?: readonly LaneDragCard[];
}

/** One drop: shaped like AL-236's `agent:launchFromAdo` request, so its launch can take it as it is. */
export interface LaneDrop {
  source: LaneDropSource;
  lane: Lane;
}

export interface LaneDropOptions {
  /** Alt was held as the card was dropped: the launch sheet opens first (AL-240). */
  alt?: boolean;
  /** What the drop rules say the drop does. */
  action?: DropAction;
}

/**
 * Starts the agent for a drop (AL-236's `useLaunchFromAdo`). Resolves to anything once main confirmed
 * the launch, or null when it did not happen (refused, cancelled, failed): the optimistic board update
 * is then rolled back.
 */
export type LaunchFromLane = (drop: LaneDrop, options: LaneDropOptions) => Promise<unknown>;

/** How a drag was started: the pointer, or Space on a focused card. */
export type DragInput = 'pointer' | 'keyboard';
