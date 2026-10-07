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
