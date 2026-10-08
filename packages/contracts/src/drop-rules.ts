import type { Effort, Lane, Model } from './vocabulary';

/**
 * Drop rules for the team board (AL-230, TB§3, TB§6): which agent lanes take a team-board card, a
 * backlog row or an open pull request, and what each drop does. Pure and zod-free (type imports
 * only), so the renderer's drag highlighting, the keyboard "Send to lane" menu and the main
 * process's recheck before a launch (AL-236) all run this same code.
 *
 * Only a To Do, Failed or backlog item dropped on Planning or Implementing changes Azure DevOps
 * (T5, T9): it is assigned to you and moved to In Progress.
 */

/** The team board's columns as the app knows them (T1); a board column ADO names otherwise is `other`. */
export const TEAM_BOARD_COLUMN_KINDS = ['to-do', 'in-progress', 'code-review', 'testing', 'failed'] as const;
export type TeamBoardColumnKind = (typeof TEAM_BOARD_COLUMN_KINDS)[number];

/** Someone a card names: an assignee or a pull request's author. */
export interface DropPerson {
  /** ADO identity id (GUID), when ADO sent one. */
  id?: string | null;
  /** Sign-in name (usually an email), when ADO sent one. */
  uniqueName?: string | null;
  displayName: string;
}

/** The signed-in user: the identity the Connections token test returned (TB§6 Identity). */
export interface DropMe {
  id: string;
  uniqueName?: string | null;
}

/** A work item on the team board (AL-231). */
export interface BoardItemCard {
  kind: 'board-item';
  id: number;
  column: TeamBoardColumnKind | 'other';
  assignee: DropPerson | null;
  /** The lane of the agent already working on it in this app, or null. */
  agentLane: Lane | null;
  /** The pull request linked to the item, or null. */
  pullRequestId: number | null;
  /** The item's branch, or null when it has none. */
  branch: string | null;
}

/** A row of the Backlog popout (AL-233). */
export interface BacklogItemCard {
  kind: 'backlog-item';
  id: number;
  assignee: DropPerson | null;
  agentLane: Lane | null;
}

/** An open pull request in the Active PRs column (AL-232). */
export interface PullRequestCard {
  kind: 'pull-request';
  id: number;
  author: DropPerson;
  /** Active comment threads: resolved, closed and system threads are not counted. */
  unresolvedThreads: number;
  sourceBranch: string;
  /** False when the PR's repository is not registered in Agent Lanes: the drop is refused with "Add repo" (TB§7). */
  repoRegistered?: boolean;
}

export type DropCard = BoardItemCard | BacklogItemCard | PullRequestCard;

/** Where the agent's worktree comes from. */
export type DropWorktreeSource = 'main' | 'item-branch' | 'pr-source-branch' | 'pr-branch-read-only';

/** The only ADO changes a drop makes (T5). */
export type DropAdoChange = 'assign-to-me' | 'move-to-in-progress';

/** What dropping a card on a lane does. */
export interface DropAction {
  lane: Lane;
  /** Lane card heading while dragging (artboards 09, 12): "Review this PR". */
  title: string;
  /** Short, lower-case, for announcements ("Over Code review: start agentic review"). */
  label: string;
  /** What happens, in one line: "Assigns you · moves it to In Progress · starts planning". */
  detail: string;
  /** True only for a To Do, Failed or backlog item on Planning or Implementing. */
  changesAdo: boolean;
  adoChanges: readonly DropAdoChange[];
  worktree: DropWorktreeSource;
  /** Whether the plan gate stays on (Planning) or is skipped (Implementing). Null for review, comments and QA. */
  planGate: boolean | null;
  /** The lane's default skills, model and effort (TB§3); Settings can override them per lane (AL-240). */
  skills: readonly string[];
  model: Model;
  effort: Effort;
}

/** A lane that does not take the card, and the reason to show instead of highlighting it. */
export interface DropRefusal {
  lane: Lane;
  reason: string;
}

export type DropVerdict = { ok: true; action: DropAction } | { ok: false; refusal: DropRefusal };

const LANE_ORDER: readonly Lane[] = ['queued', 'planning', 'implementing', 'code-review', 'qa', 'create-pr', 'done'];

const LANE_TITLES: Readonly<Record<Lane, string>> = {
  queued: 'Queued',
  planning: 'Planning',
  implementing: 'Implementing',
  'code-review': 'Code review',
  qa: 'QA',
  'create-pr': 'Create PR',
  done: 'Done',
};

/** Refusal reasons the UI may match on. */
export const DROP_REFUSALS = {
  queued: 'Queued fills when the agent limit is reached',
  createPr: 'Create PR is reached through the stages',
  done: 'Done takes no drops',
  noLinkedPr: 'No linked PR',
  noComments: 'No open comments',
  notAuthor: "Only the PR's author can answer its comments",
  addRepo: 'Add repo',
  notYours: 'Not assigned to you',
  notThisLane: 'This lane does not take this card',
  unknownColumn: 'Not from a column the app knows',
} as const;

/** True when the person is the signed-in user: by identity id, else by sign-in name. */
export function isMe(person: DropPerson | null, me: DropMe): boolean {
  if (!person) return false;
  if (person.id && me.id && person.id.toLowerCase() === me.id.toLowerCase()) return true;
  return Boolean(person.uniqueName && me.uniqueName && person.uniqueName.toLowerCase() === me.uniqueName.toLowerCase());
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

const ASSIGN_AND_MOVE: readonly DropAdoChange[] = ['assign-to-me', 'move-to-in-progress'];

function planAction(lane: 'planning' | 'implementing', assign: boolean, worktree: DropWorktreeSource): DropAction {
  const planning = lane === 'planning';
  const start = assign ? 'Assigns you · moves it to In Progress' : worktree === 'item-branch' ? "On the item's branch" : 'From main';
  return {
    lane,
    title: planning ? 'Plan this' : 'Skip to implementing',
    label: planning ? 'plan it' : 'implement it',
    detail: `${start} · ${planning ? 'starts planning' : 'no plan gate'}`,
    changesAdo: assign,
    adoChanges: assign ? ASSIGN_AND_MOVE : [],
    worktree,
    planGate: planning,
    skills: [],
    model: 'opus',
    effort: 'high',
  };
}

function reviewAction(): DropAction {
  return {
    lane: 'code-review',
    title: 'Review this PR',
    label: 'start agentic review',
    detail: 'Runs /code-review on the PR and posts its comments through /pr-comment-actioner. No ADO changes; others can review too',
    changesAdo: false,
    adoChanges: [],
    worktree: 'pr-branch-read-only',
    planGate: null,
    skills: ['/code-review', '/pr-comment-actioner'],
    model: 'opus',
    effort: 'high',
  };
}

function answerCommentsAction(threads: number): DropAction {
  return {
    lane: 'implementing',
    title: 'Answer PR comments',
    label: `answer ${plural(threads, 'comment')}`,
    detail: `Checks out the PR's source branch and works through ${plural(threads, 'open thread')} with /pr-comment-actioner. No ADO changes`,
    changesAdo: false,
    adoChanges: [],
    worktree: 'pr-source-branch',
    planGate: null,
    skills: ['/pr-comment-actioner'],
    model: 'sonnet',
    effort: 'high',
  };
}

function qaAction(worktree: DropWorktreeSource): DropAction {
  return {
    lane: 'qa',
    title: 'QA this item',
    label: 'check its acceptance criteria',
    detail: 'Builds the branch and checks each acceptance criterion with /cs-qa-wip. No ADO changes',
    changesAdo: false,
    adoChanges: [],
    worktree,
    planGate: null,
    skills: ['/cs-qa-wip'],
    model: 'sonnet',
    effort: 'medium',
  };
}

const allow = (action: DropAction): DropVerdict => ({ ok: true, action });
const refuse = (lane: Lane, reason: string): DropVerdict => ({ ok: false, refusal: { lane, reason } });

function pullRequestVerdict(card: PullRequestCard, lane: Lane, me: DropMe): DropVerdict {
  if (lane !== 'code-review' && lane !== 'implementing') return refuse(lane, DROP_REFUSALS.notThisLane);
  if (card.repoRegistered === false) return refuse(lane, DROP_REFUSALS.addRepo);
  // Anyone can review an open PR, several people at once (T7).
  if (lane === 'code-review') return allow(reviewAction());
  if (!isMe(card.author, me)) return refuse(lane, DROP_REFUSALS.notAuthor);
  if (card.unresolvedThreads <= 0) return refuse(lane, DROP_REFUSALS.noComments);
  return allow(answerCommentsAction(card.unresolvedThreads));
}

/** Why an item can't be dragged by this user at all, before its column is looked at; null when it can. */
function itemLock(card: BoardItemCard | BacklogItemCard, me: DropMe, anyoneMay: boolean): string | null {
  if (card.agentLane) return `Agent in ${LANE_TITLES[card.agentLane]}`;
  if (!anyoneMay && card.assignee && !isMe(card.assignee, me)) return `Assigned to ${card.assignee.displayName}`;
  return null;
}

function itemVerdict(card: BoardItemCard | BacklogItemCard, lane: Lane, me: DropMe): DropVerdict {
  const column = card.kind === 'backlog-item' ? 'to-do' : card.column;
  if (column === 'other') return refuse(lane, card.agentLane ? `Agent in ${LANE_TITLES[card.agentLane]}` : DROP_REFUSALS.unknownColumn);

  // A Code Review item can be reviewed by anyone (TB§3); every other column needs it yours or unassigned.
  const lock = itemLock(card, me, column === 'code-review');
  if (lock) return refuse(lane, lock);

  const branch = card.kind === 'board-item' ? card.branch : null;
  const itemOrMain: DropWorktreeSource = branch ? 'item-branch' : 'main';

  switch (column) {
    case 'to-do':
    case 'failed':
      return lane === 'planning' || lane === 'implementing' ? allow(planAction(lane, true, 'main')) : refuse(lane, DROP_REFUSALS.notThisLane);
    case 'in-progress':
      // Yours only: an unassigned In Progress item is not picked up here.
      if (!isMe(card.assignee, me)) return refuse(lane, DROP_REFUSALS.notYours);
      return lane === 'planning' || lane === 'implementing' ? allow(planAction(lane, false, itemOrMain)) : refuse(lane, DROP_REFUSALS.notThisLane);
    case 'code-review': {
      if (lane !== 'code-review') return refuse(lane, DROP_REFUSALS.notThisLane);
      const pullRequestId = card.kind === 'board-item' ? card.pullRequestId : null;
      return pullRequestId === null ? refuse(lane, DROP_REFUSALS.noLinkedPr) : allow(reviewAction());
    }
    case 'testing':
      return lane === 'qa' ? allow(qaAction(itemOrMain)) : refuse(lane, DROP_REFUSALS.notThisLane);
  }
}

/** What dropping the card on one lane does, or why that lane refuses it. */
export function dropVerdict(card: DropCard, lane: Lane, me: DropMe): DropVerdict {
  // Queued fills only at the agent limit; Create PR is reached through the stages (TB§3).
  if (lane === 'queued') return refuse(lane, DROP_REFUSALS.queued);
  if (lane === 'create-pr') return refuse(lane, DROP_REFUSALS.createPr);
  if (lane === 'done') return refuse(lane, DROP_REFUSALS.done);
  return card.kind === 'pull-request' ? pullRequestVerdict(card, lane, me) : itemVerdict(card, lane, me);
}

/** Every lane that takes the card, with what the drop does. Lanes that refuse are left out. */
export function allowedLanes(card: DropCard, me: DropMe): Partial<Record<Lane, DropAction>> {
  const allowed: Partial<Record<Lane, DropAction>> = {};
  for (const lane of LANE_ORDER) {
    const verdict = dropVerdict(card, lane, me);
    if (verdict.ok) allowed[lane] = verdict.action;
  }
  return allowed;
}

/** Every lane that refuses the card, with the reason to show (e.g. "No linked PR" on Code review). */
export function refusedLanes(card: DropCard, me: DropMe): Partial<Record<Lane, string>> {
  const refused: Partial<Record<Lane, string>> = {};
  for (const lane of LANE_ORDER) {
    const verdict = dropVerdict(card, lane, me);
    if (!verdict.ok) refused[lane] = verdict.refusal.reason;
  }
  return refused;
}

/**
 * Why the card can't be picked up at all (a lock: "Assigned to MD", "Agent in Implementing"), or null
 * when at least one lane takes it.
 */
export function dragLock(card: DropCard, me: DropMe): string | null {
  if (Object.keys(allowedLanes(card, me)).length > 0) return null;
  const refused = refusedLanes(card, me);
  const reasons = (['planning', 'implementing', 'code-review', 'qa'] as const).map((lane) => refused[lane]);
  return reasons.find((reason) => reason !== undefined && reason !== DROP_REFUSALS.notThisLane) ?? DROP_REFUSALS.notThisLane;
}
