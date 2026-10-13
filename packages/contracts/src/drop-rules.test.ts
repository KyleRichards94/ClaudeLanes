import { describe, expect, it } from 'vitest';
import {
  DROP_REFUSALS,
  allowedLanes,
  dragLock,
  dropVerdict,
  isMe,
  refusedLanes,
  type BacklogItemCard,
  type BoardItemCard,
  type DropMe,
  type PullRequestCard,
  type TeamBoardColumnKind,
} from './drop-rules';
import { LANES, type Lane } from './vocabulary';

/** TB§3, one test per row of the table, plus the refusals under it (AL-230). */

const ME: DropMe = { id: 'kr-guid', uniqueName: 'kyle@companionsystems.com.au' };
const KR = { id: 'KR-GUID', uniqueName: 'Kyle@CompanionSystems.com.au', displayName: 'Kyle Richards' };
const MD = { id: 'md-guid', uniqueName: 'md@companionsystems.com.au', displayName: 'MD' };

function item(column: TeamBoardColumnKind | 'other', overrides: Partial<BoardItemCard> = {}): BoardItemCard {
  return { kind: 'board-item', id: 71341, column, assignee: null, agentLane: null, pullRequestId: null, branch: null, ...overrides };
}

function backlog(overrides: Partial<BacklogItemCard> = {}): BacklogItemCard {
  return { kind: 'backlog-item', id: 71360, assignee: null, agentLane: null, ...overrides };
}

function pr(overrides: Partial<PullRequestCard> = {}): PullRequestCard {
  return { kind: 'pull-request', id: 10571, author: KR, unresolvedThreads: 6, sourceBranch: '71240-job-notes-editor', ...overrides };
}

const lanesOf = (allowed: object) => Object.keys(allowed).sort();

describe('drop rules (AL-230, TB§3)', () => {
  describe('row 1–2: To Do, Failed or Backlog item → Planning or Implementing (the only ADO change)', () => {
    const cards = [
      ['To Do, unassigned', item('to-do')],
      ['To Do, yours', item('to-do', { assignee: KR })],
      ['Failed, yours', item('failed', { assignee: KR })],
      ['Failed, unassigned', item('failed')],
      ['Backlog, unassigned', backlog()],
      ['Backlog, yours', backlog({ assignee: KR })],
    ] as const;

    it.each(cards)('%s lights up Planning, Implementing and QA only (no branch to review or open a PR from)', (_, card) => {
      expect(lanesOf(allowedLanes(card, ME))).toEqual(['implementing', 'planning', 'qa-only']);
      expect(dragLock(card, ME)).toBeNull();
    });

    it.each(cards)('%s on Planning assigns you, moves it to In Progress and keeps the plan gate', (_, card) => {
      const planning = allowedLanes(card, ME).planning!;
      expect(planning).toMatchObject({
        changesAdo: true,
        adoChanges: ['assign-to-me', 'move-to-in-progress'],
        worktree: 'main',
        planGate: true,
        skills: [],
        model: 'opus',
        effort: 'high',
        title: 'Plan this',
        detail: 'Assigns you · moves it to In Progress · starts planning',
      });
    });

    it.each(cards)('%s on Implementing assigns you, moves it to In Progress and skips the plan gate', (_, card) => {
      expect(allowedLanes(card, ME).implementing).toMatchObject({
        changesAdo: true,
        adoChanges: ['assign-to-me', 'move-to-in-progress'],
        worktree: 'main',
        planGate: false,
        model: 'opus',
        effort: 'high',
        title: 'Skip to implementing',
        detail: 'Assigns you · moves it to In Progress · no plan gate',
      });
    });
  });

  describe('row 3: In Progress item, yours or unassigned → Planning or Implementing, assigned to you and kept In Progress', () => {
    it("starts on the item's branch when it has one", () => {
      const allowed = allowedLanes(item('in-progress', { assignee: KR, branch: '71273-cutover-job-control' }), ME);
      expect(lanesOf(allowed)).toEqual(['implementing', 'planning', 'pr-only', 'qa-only', 'review-only']);
      expect(allowed.planning).toMatchObject({ changesAdo: true, adoChanges: ['assign-to-me', 'move-to-in-progress'], worktree: 'item-branch', planGate: true, model: 'opus', effort: 'high' });
      expect(allowed.implementing).toMatchObject({ changesAdo: true, worktree: 'item-branch', planGate: false });
    });

    it('starts from main when it has no branch', () => {
      const allowed = allowedLanes(item('in-progress', { assignee: KR }), ME);
      expect(allowed.planning).toMatchObject({ worktree: 'main', changesAdo: true });
    });

    it("an unassigned one is assigned to you; someone else's is refused", () => {
      expect(allowedLanes(item('in-progress'), ME).planning).toMatchObject({ changesAdo: true, detail: 'Assigns you · moves it to In Progress · starts planning' });
      expect(allowedLanes(item('in-progress', { assignee: MD }), ME)).toEqual({});
      expect(dragLock(item('in-progress', { assignee: MD }), ME)).toBe('Assigned to MD');
    });
  });

  describe('row 4: Code Review item or any open PR → Code review, anyone, several at once', () => {
    const review = {
      lane: 'code-review',
      label: 'start agentic review',
      title: 'Review this PR',
      changesAdo: false,
      adoChanges: [],
      worktree: 'pr-branch-read-only',
      skills: ['/code-review', '/pr-comment-actioner'],
      model: 'opus',
      effort: 'high',
    };

    it.each([
      ['yours', KR],
      ['unassigned', null],
      ["someone else's", MD],
    ] as const)('a Code Review item with a linked PR, %s, goes to Code review and Review only', (_, assignee) => {
      const allowed = allowedLanes(item('code-review', { assignee, pullRequestId: 10598 }), ME);
      expect(lanesOf(allowed).filter((lane) => lane !== 'qa-only' && lane !== 'comments-only')).toEqual(['code-review', 'review-only']);
      // Resolving its PR's comments needs it yours or nobody's, as QA only does.
      expect(allowed['comments-only'] !== undefined).toBe(assignee !== MD);
      expect(allowed['code-review']).toMatchObject(review);
      expect(allowed['review-only']).toMatchObject({ changesAdo: false, worktree: 'pr-branch-read-only', skills: ['/code-review'] });
      // QA only needs it yours or nobody's.
      expect(allowed['qa-only'] !== undefined).toBe(assignee !== MD);
    });

    it('a Code Review item with no linked PR is refused by Code review with "No linked PR"', () => {
      const card = item('code-review', { assignee: MD });
      expect(allowedLanes(card, ME)).toEqual({});
      expect(refusedLanes(card, ME)['code-review']).toBe('No linked PR');
      expect(dragLock(card, ME)).toBe('No linked PR');
    });

    it("an open PR can be dropped on Code review by anyone: its author, someone else, and several people at once", () => {
      const others: DropMe[] = [ME, { id: 'md-guid' }, { id: 'ty-guid', uniqueName: 'ty@companionsystems.com.au' }];
      for (const user of others) {
        expect(allowedLanes(pr({ author: MD }), user)['code-review']).toMatchObject(review);
        expect(allowedLanes(pr({ author: KR, unresolvedThreads: 0 }), user)['code-review']).toMatchObject(review);
      }
    });
  });

  describe('row 5: your open PR with comments → Implementing', () => {
    it('answers the open threads on the source branch with /pr-comment-actioner, Sonnet High', () => {
      const allowed = allowedLanes(pr({ unresolvedThreads: 4 }), ME);
      expect(lanesOf(allowed)).toEqual(['code-review', 'comments-only', 'implementing', 'review-only']);
      expect(allowed.implementing).toMatchObject({
        title: 'Answer PR comments',
        label: 'answer 4 comments',
        changesAdo: false,
        worktree: 'pr-source-branch',
        skills: ['/pr-comment-actioner'],
        model: 'sonnet',
        effort: 'high',
      });
      expect(allowedLanes(pr({ unresolvedThreads: 1 }), ME).implementing?.label).toBe('answer 1 comment');
    });

    it('a PR with 0 threads is not taken by Implementing', () => {
      const card = pr({ unresolvedThreads: 0 });
      expect(allowedLanes(card, ME).implementing).toBeUndefined();
      expect(refusedLanes(card, ME).implementing).toBe(DROP_REFUSALS.noComments);
    });

    it("someone else's PR is not taken by Implementing", () => {
      expect(dropVerdict(pr({ author: MD }), 'implementing', ME)).toEqual({ ok: false, refusal: { lane: 'implementing', reason: DROP_REFUSALS.notAuthor } });
    });

    it('a PR in a repo that is not registered is refused with "Add repo" (TB§7)', () => {
      const card = pr({ repoRegistered: false });
      expect(allowedLanes(card, ME)).toEqual({});
      expect(dragLock(card, ME)).toBe('Add repo');
    });
  });

  describe('row 6: Testing item → QA', () => {
    it.each([
      ['yours', KR],
      ['unassigned', null],
    ] as const)('%s builds the branch and checks the criteria with /cs-qa-wip, Sonnet Med', (_, assignee) => {
      const allowed = allowedLanes(item('testing', { assignee, branch: '71310-timesheet-export' }), ME);
      expect(lanesOf(allowed)).toEqual(['pr-only', 'qa', 'qa-only', 'review-only']);
      expect(allowed['qa-only']).toMatchObject({ changesAdo: false, worktree: 'item-branch', skills: ['/cs-qa-wip'] });
      expect(allowed.qa).toMatchObject({ changesAdo: false, worktree: 'item-branch', skills: ['/cs-qa-wip'], model: 'sonnet', effort: 'medium' });
    });

    it("someone else's Testing item is locked", () => {
      expect(allowedLanes(item('testing', { assignee: MD }), ME)).toEqual({});
      expect(dragLock(item('testing', { assignee: MD }), ME)).toBe('Assigned to MD');
    });
  });

  describe('row 7: assigned to someone else, or with an agent already → not draggable', () => {
    it.each([
      ['To Do', item('to-do', { assignee: MD })],
      ['Failed', item('failed', { assignee: MD })],
      ['Backlog', backlog({ assignee: MD })],
    ] as const)('%s item assigned to someone else shows a lock with their name', (_, card) => {
      expect(allowedLanes(card, ME)).toEqual({});
      expect(dragLock(card, ME)).toBe('Assigned to MD');
    });

    it.each([
      ['In Progress', item('in-progress', { assignee: KR, agentLane: 'implementing' }), 'Agent in Implementing'],
      ['Code Review', item('code-review', { pullRequestId: 10604, agentLane: 'code-review' }), 'Agent in Code review'],
      ['Testing', item('testing', { agentLane: 'qa' }), 'Agent in QA'],
      ['Backlog', backlog({ agentLane: 'planning' }), 'Agent in Planning'],
    ] as const)('%s item that already has an agent shows "Agent in …"', (_, card, reason) => {
      expect(allowedLanes(card, ME)).toEqual({});
      expect(dragLock(card, ME)).toBe(reason);
    });

    it('a column the app does not know takes no drops', () => {
      expect(allowedLanes(item('other', { assignee: KR }), ME)).toEqual({});
      expect(dragLock(item('other'), ME)).toBe(DROP_REFUSALS.unknownColumn);
    });
  });

  describe('lanes that never accept', () => {
    const everyCard = [
      item('to-do'),
      item('in-progress', { assignee: KR, branch: 'b' }),
      item('code-review', { pullRequestId: 1 }),
      item('testing'),
      item('failed'),
      backlog(),
      pr(),
    ];

    it.each(['queued', 'create-pr', 'done'] satisfies Lane[])('%s never accepts a drop', (lane) => {
      for (const card of everyCard) {
        expect(allowedLanes(card, ME)[lane]).toBeUndefined();
        expect(dropVerdict(card, lane, ME).ok).toBe(false);
      }
      expect(refusedLanes(item('to-do'), ME).queued).toBe(DROP_REFUSALS.queued);
      expect(refusedLanes(item('to-do'), ME)['create-pr']).toBe(DROP_REFUSALS.createPr);
    });

    it('every lane is either allowed or refused, never both', () => {
      for (const card of everyCard) {
        const allowed = allowedLanes(card, ME);
        const refused = refusedLanes(card, ME);
        expect([...Object.keys(allowed), ...Object.keys(refused)].sort()).toEqual([...LANES].sort());
        for (const [lane, action] of Object.entries(allowed)) expect(action.lane).toBe(lane);
      }
    });

    it('only To Do, Failed, In Progress and backlog items change ADO', () => {
      for (const card of everyCard) {
        const changes = Object.values(allowedLanes(card, ME)).some((action) => action.changesAdo);
        expect(changes).toBe(card.kind === 'backlog-item' || (card.kind === 'board-item' && (card.column === 'to-do' || card.column === 'failed' || card.column === 'in-progress')));
      }
    });
  });

  describe('single-step lanes: Review only, QA only, Create PR only', () => {
    it("Review only reviews a PR, or an item's branch, and needs one of them", () => {
      expect(allowedLanes(pr({ author: MD }), ME)['review-only']).toMatchObject({ lane: 'review-only', title: 'Review only', worktree: 'pr-branch-read-only', planGate: null, changesAdo: false });
      expect(allowedLanes(item('to-do', { branch: '71341-x' }), ME)['review-only']).toMatchObject({ worktree: 'item-branch', changesAdo: true });
      expect(refusedLanes(item('to-do'), ME)['review-only']).toBe(DROP_REFUSALS.noBranch);
    });

    it('QA only takes any item that is yours or unassigned, from its branch or main', () => {
      expect(allowedLanes(backlog(), ME)['qa-only']).toMatchObject({ worktree: 'main', skills: ['/cs-qa-wip'], model: 'sonnet', changesAdo: true });
      expect(allowedLanes(item('testing', { assignee: KR, branch: 'b' }), ME)['qa-only']).toMatchObject({ worktree: 'item-branch', changesAdo: false });
      expect(refusedLanes(item('to-do', { assignee: MD }), ME)['qa-only']).toBe('Assigned to MD');
      expect(refusedLanes(pr(), ME)['qa-only']).toBe(DROP_REFUSALS.notThisLane);
    });

    it('Resolve PR comments takes your PR with open threads, or an item with a linked PR, on the PR source branch', () => {
      expect(allowedLanes(pr({ unresolvedThreads: 4 }), ME)['comments-only']).toMatchObject({
        lane: 'comments-only',
        title: 'Resolve PR comments',
        worktree: 'pr-source-branch',
        skills: ['/pr-comment-actioner'],
        changesAdo: false,
        planGate: null,
      });
      expect(refusedLanes(pr({ author: MD }), ME)['comments-only']).toBe(DROP_REFUSALS.notAuthor);
      expect(refusedLanes(pr({ unresolvedThreads: 0 }), ME)['comments-only']).toBe(DROP_REFUSALS.noComments);
      expect(allowedLanes(item('code-review', { assignee: KR, pullRequestId: 10598 }), ME)['comments-only']).toMatchObject({ worktree: 'pr-source-branch' });
      expect(refusedLanes(item('code-review', { assignee: MD, pullRequestId: 10598 }), ME)['comments-only']).toBe('Assigned to MD');
      expect(refusedLanes(item('in-progress', { assignee: KR }), ME)['comments-only']).toBe(DROP_REFUSALS.noLinkedPr);
    });

    it("Create PR only opens a PR from the item's branch, and is refused without one", () => {
      expect(allowedLanes(item('in-progress', { assignee: KR, branch: 'b' }), ME)['pr-only']).toMatchObject({
        title: 'Create PR only',
        worktree: 'item-branch',
        detail: "Assigns you · moves it to In Progress · Commits the item's branch and opens its PR, then stops",
      });
      expect(refusedLanes(item('to-do'), ME)['pr-only']).toBe(DROP_REFUSALS.noBranch);
      expect(refusedLanes(pr(), ME)['pr-only']).toBe(DROP_REFUSALS.notThisLane);
    });
  });

  it('matches the user by identity id, else by sign-in name, case-insensitively', () => {
    expect(isMe({ id: 'KR-GUID', displayName: 'x' }, ME)).toBe(true);
    expect(isMe({ uniqueName: 'KYLE@companionsystems.com.au', displayName: 'x' }, ME)).toBe(true);
    expect(isMe({ displayName: 'Kyle Richards' }, ME)).toBe(false);
    expect(isMe(null, ME)).toBe(false);
  });
});
