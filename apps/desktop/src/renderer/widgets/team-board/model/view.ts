import {
  workItemStateColor,
  workItemTypeColor,
  type ActivePullRequest,
  type Lane,
  type TeamBoard,
  type TeamBoardColumnKindOrOther,
  type TeamBoardItem,
  type TeamBoardPerson,
  type WorkItemColors,
} from '@agent-lanes/contracts';
import { DROP_REFUSALS, LANE_LABELS, dragLock, type BoardItemCard, type DropMe, type PullRequestCard } from '@/entities/agent-ticket';
import type { LaneDragData } from '@/features/drag-to-lane';

/** Everyone / Me / Unassigned (T1). */
export type TeamBoardFilter = 'everyone' | 'me' | 'unassigned';
export const TEAM_BOARD_FILTERS: readonly TeamBoardFilter[] = ['everyone', 'me', 'unassigned'];

/** Who "me" is: the identity the Connections token test returned (TB§6 Identity). */
export interface TeamBoardMe {
  /** "Kyle Richards". */
  displayName: string;
}

export interface TeamBoardAvatar {
  initials: string;
  name: string;
  /** The signed-in user: drawn in violet (artboard 08's "KR"). */
  mine: boolean;
}

/** One work item card (artboard 08). */
export interface TeamBoardItemView {
  kind: 'item';
  id: number;
  /** "#71341". */
  idLabel: string;
  /** "Bug", "Story". */
  type: string;
  /** The type's colour on ADO's board (the card's left bar); null when not known, so the token colour is used. */
  typeColor: string | null;
  title: string;
  /** `System.State` ("Active", "Failed UAT"), shown in words after a dot in its ADO colour. */
  state: string;
  /** The state's colour on ADO's board; null when not known. */
  stateColor: string | null;
  /** "3 pts", "PR !10598"; null when neither applies (the state has its own label). */
  detail: string | null;
  /** Null for an unassigned item (shown as an empty avatar). */
  avatar: TeamBoardAvatar | null;
  /** "Assigned to Mark Davies" on an item someone else has: not draggable (T7). */
  lock: string | null;
  /** "Agent in Implementing" on an item an agent already works on. */
  agentTag: string | null;
  draggable: boolean;
  /** What dragging it onto a lane carries (AL-235); null when it can't be dragged or the board's team and sprint aren't known. */
  drag: LaneDragData | null;
  webUrl: string;
}

/** One Active PRs card: "!10598 · PR · Supplier invoice matching rules · 4 comments". */
export interface TeamBoardPullRequestView {
  kind: 'pull-request';
  id: number;
  idLabel: string;
  title: string;
  /** "4 comments", "1 comment", "0 comments". */
  comments: string;
  hasComments: boolean;
  /** The first reviewer, else the author. */
  avatar: TeamBoardAvatar;
  /** "Draft" when it is one. */
  draft: boolean;
  /** "Repo not in Agent Lanes" when the drop would be refused with Add repo (TB§7). */
  note: string | null;
  draggable: boolean;
  /** What dragging it onto a lane carries (AL-235); null when it can't be dragged. */
  drag: LaneDragData | null;
  webUrl: string;
}

/** The board a card is on: a drop tells main which team and sprint to read it from again (AL-236). */
export interface TeamBoardDropContext {
  teamId: string;
  sprintPath: string;
}

export type ColumnTone = 'neutral' | 'ado' | 'claude' | 'attention' | 'danger' | 'ink';

export interface TeamBoardColumnView {
  id: string;
  name: string;
  kind: TeamBoardColumnKindOrOther | 'active-prs';
  /** The column's dot colour (artboard 08). */
  tone: ColumnTone;
  count: number;
  cards: readonly (TeamBoardItemView | TeamBoardPullRequestView)[];
}

const COLUMN_TONES: Readonly<Record<TeamBoardColumnKindOrOther, ColumnTone>> = {
  'to-do': 'neutral',
  'in-progress': 'ado',
  'code-review': 'claude',
  testing: 'attention',
  failed: 'danger',
  other: 'neutral',
};

/** Items carry ADO's type name; the board says "Story" for "User Story" and "Product Backlog Item" (artboard 08). */
function shortType(type: string): string {
  if (type === 'User Story' || type === 'Product Backlog Item') return 'Story';
  return type;
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** The person is the signed-in user, by display or sign-in name (the token test returns the display name). */
export function isMine(person: Pick<TeamBoardPerson, 'displayName' | 'uniqueName'> | null, me: TeamBoardMe | null): boolean {
  if (!person || !me) return false;
  return sameName(person.displayName, me.displayName) || sameName(person.uniqueName, me.displayName);
}

/** The drop rules (AL-230) key "me" by identity id; the board knows the user by name, so a match is marked with this id. */
const ME_ID = 'agent-lanes:me';
const DROP_ME: DropMe = { id: ME_ID };

function dropPerson(person: TeamBoardPerson | null, me: TeamBoardMe | null) {
  if (!person) return null;
  return isMine(person, me) ? { id: ME_ID, displayName: person.displayName } : { id: person.id ?? null, displayName: person.displayName };
}

function avatarOf(person: TeamBoardPerson, me: TeamBoardMe | null): TeamBoardAvatar {
  return { initials: person.initials, name: person.displayName, mine: isMine(person, me) };
}

function itemDetail(item: TeamBoardItem): string | null {
  if (item.columnKind === 'code-review' && item.pullRequestId !== null) return `PR !${item.pullRequestId}`;
  if (item.points !== null) return `${item.points} pts`;
  return null;
}

export function itemView(
  item: TeamBoardItem,
  me: TeamBoardMe | null,
  agentLane: Lane | null,
  board: TeamBoardDropContext | null = null,
  colors: WorkItemColors | null = null,
): TeamBoardItemView {
  const card: BoardItemCard = {
    kind: 'board-item',
    id: item.id,
    column: item.columnKind,
    assignee: dropPerson(item.assignee, me),
    agentLane,
    pullRequestId: item.pullRequestId,
    branch: item.branch,
  };
  const reason = dragLock(card, DROP_ME);
  const lockedByOther = reason !== null && item.assignee !== null && !isMine(item.assignee, me) && reason.startsWith('Assigned to');
  // A Code Review item with no linked PR can still be picked up, so the Code review lane can say "No linked PR" (TB§3).
  const pickable = reason === null || reason === DROP_REFUSALS.noLinkedPr;
  const drag: LaneDragData | null =
    pickable && board
      ? {
          key: `item:${item.id}`,
          label: `#${item.id}`,
          title: item.title,
          card,
          me: DROP_ME,
          meName: me?.displayName ?? null,
          source: { kind: 'board-item', id: item.id, team: board.teamId, sprint: board.sprintPath, column: item.column },
        }
      : null;
  return {
    kind: 'item',
    id: item.id,
    idLabel: `#${item.id}`,
    type: shortType(item.type),
    typeColor: workItemTypeColor(colors, item.type),
    title: item.title,
    state: item.state,
    stateColor: workItemStateColor(colors, item.type, item.state),
    detail: itemDetail(item),
    avatar: item.assignee ? avatarOf(item.assignee, me) : null,
    lock: lockedByOther ? reason : null,
    agentTag: agentLane ? `Agent in ${LANE_LABELS[agentLane]}` : null,
    draggable: pickable,
    drag,
    webUrl: item.webUrl,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function pullRequestView(pr: ActivePullRequest, me: TeamBoardMe | null, teamId: string | null = null): TeamBoardPullRequestView {
  const reviewer = pr.reviewers.find((person) => !person.isContainer);
  const card: PullRequestCard = {
    kind: 'pull-request',
    id: pr.id,
    author: dropPerson(pr.author, me) ?? { displayName: pr.author.displayName },
    unresolvedThreads: pr.unresolvedThreads,
    sourceBranch: pr.sourceBranch,
    repoRegistered: pr.repoRegistered,
  };
  const draggable = dragLock(card, DROP_ME) === null;
  return {
    kind: 'pull-request',
    id: pr.id,
    idLabel: `!${pr.id}`,
    title: pr.title,
    comments: plural(pr.unresolvedThreads, 'comment'),
    hasComments: pr.unresolvedThreads > 0,
    avatar: avatarOf(reviewer ?? pr.author, me),
    draft: pr.isDraft,
    note: pr.repoRegistered ? null : 'Repo not in Agent Lanes',
    draggable,
    drag: draggable
      ? {
          key: `pr:${pr.id}`,
          label: `!${pr.id}`,
          title: pr.title,
          card,
          me: DROP_ME,
          meName: me?.displayName ?? null,
          source: { kind: 'pull-request', id: pr.id, ...(teamId ? { team: teamId } : {}) },
        }
      : null,
    webUrl: pr.webUrl,
  };
}

function itemPasses(item: TeamBoardItem, filter: TeamBoardFilter, me: TeamBoardMe | null): boolean {
  if (filter === 'me') return isMine(item.assignee, me);
  if (filter === 'unassigned') return item.assignee === null;
  return true;
}

/** Me: PRs I wrote or review. Unassigned: PRs nobody reviews yet. */
function pullRequestPasses(pr: ActivePullRequest, filter: TeamBoardFilter, me: TeamBoardMe | null): boolean {
  const people = pr.reviewers.filter((person) => !person.isContainer);
  if (filter === 'me') return isMine(pr.author, me) || people.some((person) => isMine(person, me));
  if (filter === 'unassigned') return people.length === 0;
  return true;
}

/**
 * The board's columns left to right as the team's ADO board names them, then Active PRs (T1, artboard
 * 08), each with its count and cards after the filter. `workItemLanes` maps a work item id to the lane
 * of the agent already on it (AL-143's store).
 */
export function teamBoardColumns(input: {
  board: TeamBoard | undefined;
  pullRequests: readonly ActivePullRequest[] | undefined;
  me: TeamBoardMe | null;
  workItemLanes: Readonly<Record<string, Lane>>;
  filter: TeamBoardFilter;
  /** ADO's type and state colours (`ado:workItemColors`); null or left out while unknown. */
  colors?: WorkItemColors | null;
}): readonly TeamBoardColumnView[] {
  const { board, pullRequests, me, workItemLanes, filter, colors = null } = input;
  const dropContext: TeamBoardDropContext | null = board ? { teamId: board.team.id, sprintPath: board.sprint.path } : null;
  const columns: TeamBoardColumnView[] = (board?.columns ?? []).map((column) => {
    const cards = board!.items
      .filter((item) => item.columnId === column.id && itemPasses(item, filter, me))
      .map((item) => itemView(item, me, workItemLanes[String(item.id)] ?? null, dropContext, colors));
    return { id: column.id, name: column.name, kind: column.kind, tone: COLUMN_TONES[column.kind], count: cards.length, cards };
  });
  const prCards = (pullRequests ?? []).filter((pr) => pullRequestPasses(pr, filter, me)).map((pr) => pullRequestView(pr, me, dropContext?.teamId ?? null));
  columns.push({ id: 'active-prs', name: 'Active PRs', kind: 'active-prs', tone: 'ink', count: prCards.length, cards: prCards });
  return columns;
}
