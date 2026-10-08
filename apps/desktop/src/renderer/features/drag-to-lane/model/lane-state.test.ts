import { LANES } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import type { DropCard } from '@/entities/agent-ticket';
import {
  activeDrag,
  allowedLaneList,
  cancelAnnouncement,
  dragLabel,
  dragStatusText,
  dropAnnouncement,
  laneDropState,
  overAnnouncement,
  pickUpAnnouncement,
  sentAnnouncement,
} from './lane-state';
import type { LaneDragCard } from './types';

const ME = { id: 'me' };
const KR = { id: 'me', displayName: 'Kyle Richards' };
const MD = { id: 'md', displayName: 'Mark Davies' };

function drag(card: DropCard, label: string): LaneDragCard {
  return { key: label, label, title: 'Job notes rich text editor', card, me: ME, meName: 'Kyle Richards', source: { kind: 'pull-request', id: card.id } };
}

/** Artboard 09: your PR !10571 with 6 open threads, in a registered repo. */
const PR_10571 = drag({ kind: 'pull-request', id: 10571, author: KR, unresolvedThreads: 6, sourceBranch: '71240-job-notes-editor', repoRegistered: true }, '!10571');

describe('laneDropState (AL-235, artboard 09)', () => {
  it('lights Implementing and Code review only while PR !10571 is dragged; the rest dim', () => {
    const active = activeDrag(PR_10571, 'pointer');
    const states = Object.fromEntries(LANES.map((lane) => [lane, laneDropState(active, lane, null).kind]));
    expect(states).toEqual({
      queued: 'refuse',
      planning: 'refuse',
      implementing: 'accept',
      'code-review': 'accept',
      qa: 'refuse',
      'create-pr': 'refuse',
      done: 'refuse',
    });
    expect(laneDropState(active, 'implementing', null)).toMatchObject({ kind: 'accept', over: false, action: { title: 'Answer PR comments', label: 'answer 6 comments' } });
    expect(laneDropState(active, 'code-review', 'code-review')).toMatchObject({ kind: 'accept', over: true, action: { title: 'Review this PR' } });
    // Plain refusals just dim the lane; they don't say anything.
    expect(laneDropState(active, 'qa', null)).toEqual({ kind: 'refuse', reason: null });
  });

  it('is idle with nothing dragged', () => {
    expect(laneDropState(null, 'planning', null)).toEqual({ kind: 'idle' });
  });

  it('says "No linked PR" on Code review for a Code Review item without one', () => {
    const item = drag({ kind: 'board-item', id: 71300, column: 'code-review', assignee: null, agentLane: null, pullRequestId: null, branch: null }, '#71300');
    expect(laneDropState(activeDrag(item, 'pointer'), 'code-review', null)).toEqual({ kind: 'refuse', reason: 'No linked PR' });
  });

  it("says why Implementing won't take someone else's PR, and that a PR with no threads has nothing to answer", () => {
    const theirs = drag({ kind: 'pull-request', id: 10598, author: MD, unresolvedThreads: 4, sourceBranch: 'x', repoRegistered: true }, '!10598');
    expect(laneDropState(activeDrag(theirs, 'pointer'), 'implementing', null)).toEqual({ kind: 'refuse', reason: "Only the PR's author can answer its comments" });
    const quiet = drag({ kind: 'pull-request', id: 10599, author: KR, unresolvedThreads: 0, sourceBranch: 'x', repoRegistered: true }, '!10599');
    expect(laneDropState(activeDrag(quiet, 'pointer'), 'implementing', null)).toEqual({ kind: 'refuse', reason: 'No open comments' });
  });
});

describe('allowedLaneList', () => {
  it('lists the lanes that take the card, left to right, for the Send to lane menu', () => {
    expect(allowedLaneList(PR_10571).map(({ lane, action }) => `${lane}: ${action.label}`)).toEqual(['implementing: answer 6 comments', 'code-review: start agentic review']);
    const failed = drag({ kind: 'board-item', id: 71318, column: 'failed', assignee: KR, agentLane: null, pullRequestId: null, branch: null }, '#71318');
    expect(allowedLaneList(failed).map(({ lane }) => lane)).toEqual(['planning', 'implementing']);
  });
});

describe('announcements (TB§7)', () => {
  it('says what each lane does as the card moves over it, and what happened at the end', () => {
    const keyboard = activeDrag(PR_10571, 'keyboard');
    expect(pickUpAnnouncement(keyboard)).toBe(
      'Picked up !10571. Implementing and Code review take it. Use the arrow keys to move between them, Space to drop, Escape to cancel.',
    );
    expect(pickUpAnnouncement(activeDrag(PR_10571, 'pointer'))).toBe('Picked up !10571. Implementing and Code review take it.');
    expect(overAnnouncement(keyboard, 'code-review')).toBe('Over Code review: start agentic review');
    expect(overAnnouncement(keyboard, 'implementing')).toBe('Over Implementing: answer 6 comments');
    expect(overAnnouncement(keyboard, null)).toBe('!10571 is not over a lane that takes it.');
    expect(dropAnnouncement(keyboard, 'code-review')).toBe('Dropped !10571 on Code review: start agentic review');
    expect(dropAnnouncement(keyboard, null)).toBe('!10571 was not dropped on a lane. It is back in its column.');
    expect(cancelAnnouncement(keyboard)).toBe('Cancelled. !10571 is back in its column.');
    expect(sentAnnouncement(PR_10571, 'implementing', keyboard.allowed.implementing!)).toBe('Sent !10571 to Implementing: answer 6 comments');
  });

  it('names one accepting lane in the singular, and says when none takes the card', () => {
    const theirs = drag({ kind: 'pull-request', id: 10598, author: MD, unresolvedThreads: 4, sourceBranch: 'x', repoRegistered: true }, '!10598');
    expect(pickUpAnnouncement(activeDrag(theirs, 'pointer'))).toBe('Picked up !10598. Code review takes it.');
    const unregistered = drag({ kind: 'pull-request', id: 10590, author: KR, unresolvedThreads: 0, sourceBranch: 'x', repoRegistered: false }, '!10590');
    expect(pickUpAnnouncement(activeDrag(unregistered, 'pointer'))).toBe('Picked up !10590. No lane takes it.');
    expect(dragStatusText(activeDrag(unregistered, 'pointer'))).toBe('No lane takes !10590');
    expect(dragStatusText(activeDrag(PR_10571, 'pointer'))).toBe('Drop !10571 on a highlighted lane');
  });
});

describe('group drags (AL-239, TB§5, artboard 12)', () => {
  const backlog = (id: number, assignee: typeof KR | null = null): LaneDragCard => ({
    key: `backlog:${id}`,
    label: `#${id}`,
    title: `Backlog ${id}`,
    card: { kind: 'backlog-item', id, assignee, agentLane: null },
    me: ME,
    meName: 'Kyle Richards',
    source: { kind: 'backlog-item', id },
  });
  const pair = [backlog(71360), backlog(71335, KR)];
  const group: LaneDragCard = { ...pair[0]!, group: pair };

  it('lights only Planning and Implementing for two backlog rows, titled for several', () => {
    const active = activeDrag(group, 'pointer');
    expect(active.card.label).toBe('2 items');
    expect(LANES.filter((lane) => active.allowed[lane])).toEqual(['planning', 'implementing']);
    expect(active.allowed.planning).toMatchObject({ title: 'Plan these', detail: 'Assigns you · moves it to In Progress · starts planning' });
    expect(active.allowed.implementing).toMatchObject({ title: 'Skip to implementing' });
    expect(dragStatusText(active)).toBe('Dragging 2 items — drop on Planning or Implementing');
    expect(pickUpAnnouncement(active)).toBe('Picked up 2 items. Planning and Implementing take it.');
    expect(dragLabel(group)).toBe('2 items');
    expect(allowedLaneList(group).map(({ lane, action }) => [lane, action.title])).toEqual([
      ['planning', 'Plan these'],
      ['implementing', 'Skip to implementing'],
    ]);
  });

  it('goes only to lanes that take every card of the group', () => {
    const testing = drag({ kind: 'board-item', id: 71318, column: 'testing', assignee: null, agentLane: null, pullRequestId: null, branch: null }, '#71318');
    const mixed: LaneDragCard = { ...pair[0]!, group: [pair[0]!, testing] };
    expect(LANES.filter((lane) => activeDrag(mixed, 'pointer').allowed[lane])).toEqual([]);
  });

  it('is an ordinary drag for a group of one', () => {
    const one: LaneDragCard = { ...pair[0]!, group: [pair[0]!] };
    const active = activeDrag(one, 'pointer');
    expect(active.card.label).toBe('#71360');
    expect(active.allowed.planning?.title).toBe('Plan this');
    expect(dragStatusText(active)).toBe('Drop #71360 on a highlighted lane');
  });
});
