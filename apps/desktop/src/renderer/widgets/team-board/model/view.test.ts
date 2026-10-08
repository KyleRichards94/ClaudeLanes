import type { ActivePullRequest, TeamBoard, TeamBoardItem, TeamBoardPerson } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { isMine, itemView, pullRequestView, teamBoardColumns } from './view';

const me = { displayName: 'Kyle Richards' };

function person(displayName: string, initials: string): TeamBoardPerson {
  return { id: `id-${initials}`, displayName, uniqueName: `${initials.toLowerCase()}@example.test`, initials };
}
const KR = person('Kyle Richards', 'KR');
const MD = person('Mark Davies', 'MD');

function item(id: number, fields: Partial<TeamBoardItem> = {}): TeamBoardItem {
  return {
    id,
    type: 'Bug',
    title: `Item ${id}`,
    state: 'Active',
    points: null,
    columnId: 'todo',
    column: 'To Do',
    columnKind: 'to-do',
    assignee: null,
    branch: null,
    pullRequestId: null,
    webUrl: `https://dev.azure.com/x/_workitems/edit/${id}`,
    ...fields,
  };
}

function pr(id: number, fields: Partial<ActivePullRequest> = {}): ActivePullRequest {
  return {
    id,
    title: `PR ${id}`,
    isDraft: false,
    author: MD,
    reviewers: [],
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    repository: { id: 'r', name: 'onsite-companion', projectId: 'p', projectName: 'OnSite' },
    createdAt: '2026-10-07T03:00:00.000Z',
    unresolvedThreads: 0,
    repoRegistered: true,
    webUrl: `https://dev.azure.com/x/_git/r/pullrequest/${id}`,
    ...fields,
  };
}

describe('itemView (AL-234)', () => {
  it('reads like artboard 08: id chip, Story for User Story, points and avatar', () => {
    expect(itemView(item(71335, { type: 'User Story', points: 5 }), me, null)).toMatchObject({
      idLabel: '#71335',
      type: 'Story',
      detail: '5 pts',
      avatar: null,
      lock: null,
      agentTag: null,
      draggable: true,
    });
  });

  it("locks someone else's item with their name", () => {
    const view = itemView(item(71341, { assignee: MD, points: 3 }), me, null);
    expect(view).toMatchObject({ lock: 'Assigned to Mark Davies', draggable: false, avatar: { initials: 'MD', mine: false } });
  });

  it('never locks my own items, and marks my avatar', () => {
    expect(itemView(item(71318, { assignee: KR, columnKind: 'failed', state: 'Failed UAT' }), me, null)).toMatchObject({
      lock: null,
      draggable: true,
      detail: 'Failed UAT',
      avatar: { initials: 'KR', mine: true },
    });
  });

  it('tags an item an agent works on instead of locking it', () => {
    expect(itemView(item(71273, { assignee: KR, columnKind: 'in-progress' }), me, 'implementing')).toMatchObject({
      agentTag: 'Agent in Implementing',
      lock: null,
      draggable: false,
    });
  });

  it('shows the linked PR on a Code Review item, and anyone may review it', () => {
    expect(itemView(item(71298, { columnKind: 'code-review', pullRequestId: 10598, assignee: MD }), me, null)).toMatchObject({
      detail: 'PR !10598',
      lock: null,
      draggable: true,
    });
  });
});

describe('pullRequestView (AL-234)', () => {
  it('shows !id, the comment count and the reviewer', () => {
    const view = pullRequestView(pr(10598, { unresolvedThreads: 4, reviewers: [{ ...person('Tim Yu', 'TY'), vote: 0, isRequired: false, isContainer: false }] }), me);
    expect(view).toMatchObject({ idLabel: '!10598', comments: '4 comments', hasComments: true, avatar: { initials: 'TY' }, draggable: true, note: null });
    expect(pullRequestView(pr(1, { unresolvedThreads: 1 }), me).comments).toBe('1 comment');
  });

  it('flags a PR from a repo Agent Lanes does not have', () => {
    expect(pullRequestView(pr(2, { repoRegistered: false }), me)).toMatchObject({ note: 'Repo not in Agent Lanes', draggable: false });
  });
});

describe('teamBoardColumns (AL-234)', () => {
  const board: TeamBoard = {
    team: { id: 't', name: 'OSC Developers' },
    sprint: { id: 's', name: 'Sprint 42', path: 'P\\Sprint 42' },
    columns: [
      { id: 'todo', name: 'To Do', kind: 'to-do' },
      { id: 'failed', name: 'Failed', kind: 'failed' },
    ],
    items: [item(1, { assignee: KR }), item(2, { assignee: MD }), item(3), item(4, { columnId: 'failed', columnKind: 'failed', assignee: KR })],
  };
  const prs = [pr(10, { author: KR }), pr(11, { reviewers: [{ ...MD, vote: 0, isRequired: false, isContainer: false }] })];

  it('keeps the board columns in order, then Active PRs, each with its count', () => {
    const columns = teamBoardColumns({ board, pullRequests: prs, me, workItemLanes: {}, filter: 'everyone' });
    expect(columns.map((column) => [column.name, column.count])).toEqual([
      ['To Do', 3],
      ['Failed', 1],
      ['Active PRs', 2],
    ]);
  });

  it('Me keeps my items and the PRs I wrote or review', () => {
    const columns = teamBoardColumns({ board, pullRequests: prs, me, workItemLanes: {}, filter: 'me' });
    expect(columns.map((column) => column.cards.map((card) => card.id))).toEqual([[1], [4], [10]]);
  });

  it('Unassigned keeps unassigned items and PRs nobody reviews yet', () => {
    const columns = teamBoardColumns({ board, pullRequests: prs, me, workItemLanes: {}, filter: 'unassigned' });
    expect(columns.map((column) => column.cards.map((card) => card.id))).toEqual([[3], [], [10]]);
  });

  it('marks agent items from the lanes', () => {
    const columns = teamBoardColumns({ board, pullRequests: [], me, workItemLanes: { '1': 'planning' }, filter: 'everyone' });
    expect(columns[0]?.cards[0]).toMatchObject({ agentTag: 'Agent in Planning' });
  });
});

describe('isMine', () => {
  it('matches by display or sign-in name, without case', () => {
    expect(isMine(KR, { displayName: 'kyle richards' })).toBe(true);
    expect(isMine({ displayName: 'Someone', uniqueName: 'Kyle Richards' }, me)).toBe(true);
    expect(isMine(MD, me)).toBe(false);
    expect(isMine(KR, null)).toBe(false);
  });
});
