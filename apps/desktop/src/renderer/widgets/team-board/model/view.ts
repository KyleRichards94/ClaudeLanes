import type { ActivePullRequest, Lane, TeamBoard, TeamBoardColumnKindOrOther, TeamBoardItem, TeamBoardPerson } from '@agent-lanes/contracts';
import { LANE_LABELS, dragLock, type BoardItemCard, type DropMe, type PullRequestCard } from '@/entities/agent-ticket';

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
  title: string;
  /** "3 pts", "PR !10598", "Resolved", "Failed UAT". */
  detail: string | null;
  /** Null for an unassigned item (shown as an empty avatar). */
  avatar: TeamBoardAvatar | null;
  /** "Assigned to Mark Davies" on an item someone else has: not draggable (T7). */
  lock: string | null;
  /** "Agent in Implementing" on an item an agent already works on. */
  agentTag: string | null;
  draggable: boolean;
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
  webUrl: string;
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
  if (item.columnKind === 'testing' || item.columnKind === 'failed') return item.state || null;
  if (item.points !== null) return `${item.points} pts`;
  return item.state || null;
}

export function itemView(item: TeamBoardItem, me: TeamBoardMe | null, agentLane: Lane | null): TeamBoardItemView {
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
  return {
    kind: 'item',
    id: item.id,
    idLabel: `#${item.id}`,
    type: shortType(item.type),
    title: item.title,
    detail: itemDetail(item),
    avatar: item.assignee ? avatarOf(item.assignee, me) : null,
    lock: lockedByOther ? reason : null,
    agentTag: agentLane ? `Agent in ${LANE_LABELS[agentLane]}` : null,
    draggable: reason === null,
    webUrl: item.webUrl,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function pullRequestView(pr: ActivePullRequest, me: TeamBoardMe | null): TeamBoardPullRequestView {
  const reviewer = pr.reviewers.find((person) => !person.isContainer);
  const card: PullRequestCard = {
    kind: 'pull-request',
    id: pr.id,
    author: dropPerson(pr.author, me) ?? { displayName: pr.author.displayName },
    unresolvedThreads: pr.unresolvedThreads,
    sourceBranch: pr.sourceBranch,
    repoRegistered: pr.repoRegistered,
  };
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
    draggable: dragLock(card, DROP_ME) === null,
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
}): readonly TeamBoardColumnView[] {
  const { board, pullRequests, me, workItemLanes, filter } = input;
  const columns: TeamBoardColumnView[] = (board?.columns ?? []).map((column) => {
    const cards = board!.items
      .filter((item) => item.columnId === column.id && itemPasses(item, filter, me))
      .map((item) => itemView(item, me, workItemLanes[String(item.id)] ?? null));
    return { id: column.id, name: column.name, kind: column.kind, tone: COLUMN_TONES[column.kind], count: cards.length, cards };
  });
  const prCards = (pullRequests ?? []).filter((pr) => pullRequestPasses(pr, filter, me)).map((pr) => pullRequestView(pr, me));
  columns.push({ id: 'active-prs', name: 'Active PRs', kind: 'active-prs', tone: 'ink', count: prCards.length, cards: prCards });
  return columns;
}
