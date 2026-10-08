/**
 * The team board's drop rules (AL-230, TB§6 "drop-rules (in agent-ticket)"). The rules live in
 * `@agent-lanes/contracts` so the main process rechecks a drop with the same code the renderer
 * highlights lanes with; this re-export is the renderer's way in.
 */
export {
  DROP_REFUSALS,
  TEAM_BOARD_COLUMN_KINDS,
  allowedLanes,
  dragLock,
  dropVerdict,
  isMe,
  refusedLanes,
  type BacklogItemCard,
  type BoardItemCard,
  type DropAction,
  type DropAdoChange,
  type DropCard,
  type DropMe,
  type DropPerson,
  type DropRefusal,
  type DropVerdict,
  type DropWorktreeSource,
  type PullRequestCard,
  type TeamBoardColumnKind,
} from '@agent-lanes/contracts';
