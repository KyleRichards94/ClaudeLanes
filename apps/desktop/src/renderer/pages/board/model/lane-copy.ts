import type { Lane } from '@agent-lanes/contracts';

/**
 * What an empty lane says (artboard 6 "Empty lane": "Nothing in QA · Tickets land here once code
 * review passes."), and the line under the collapsed Done strip ("Done · merged this sprint").
 */
export const EMPTY_LANE_COPY: Readonly<Record<Lane, { title: string; body: string }>> = {
  queued: { title: 'Nothing queued', body: 'Tickets wait here when every agent slot is busy.' },
  planning: { title: 'Nothing in Planning', body: 'New agent tickets start here.' },
  implementing: { title: 'Nothing in Implementing', body: 'Tickets land here once their plan is ready.' },
  'code-review': { title: 'Nothing in Code review', body: 'Tickets land here once implementing finishes.' },
  qa: { title: 'Nothing in QA', body: 'Tickets land here once code review passes.' },
  'create-pr': { title: 'Nothing in Create PR', body: 'Tickets land here once QA passes.' },
  done: { title: 'Nothing done yet', body: 'Merged tickets land here.' },
  'review-only': { title: 'No reviews', body: 'Drop a PR or an item with a branch: the agent only reviews it.' },
  'qa-only': { title: 'No QA runs', body: 'Drop an item: the agent only QAs it against its criteria.' },
  'pr-only': { title: 'No PRs to open', body: 'Drop an item with a branch: the agent only opens its PR.' },
  'comments-only': { title: 'No PR comments to resolve', body: 'Drop your PR, or an item with its PR: the agent works through the open threads with /pr-comment-actioner.' },
};

/** The vertical label of a collapsed lane; Done says what it holds. */
export function collapsedLaneLabel(lane: Lane, name: string): string {
  return lane === 'done' ? 'Done · merged this sprint' : name;
}

/** "3 tickets", "1 ticket". */
export function ticketCount(count: number): string {
  return `${count} ${count === 1 ? 'ticket' : 'tickets'}`;
}

/** The count badge's accessible name: "2 tickets, 1 needs you". */
export function laneBadgeLabel(count: number, needsYou: number): string {
  return needsYou > 0 ? `${ticketCount(count)}, ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you` : ticketCount(count);
}

/** An empty lane while the board shows only the tickets that need the user (AL-142). */
export function needsYouEmptyCopy(name: string): { title: string; body: string } {
  return { title: `Nothing in ${name} needs you`, body: 'Show all tickets to see the rest.' };
}
