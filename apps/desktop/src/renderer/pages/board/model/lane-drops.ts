import type { DropKind, Lane } from '@agent-lanes/contracts';

/**
 * The Settings › Drops rows a lane's agents start from: Implementing has two (an item, and your PR with
 * comments); each single-step lane has its own; Queued, Create PR and Done start no agent from a drop.
 */
const LANE_DROP_KINDS: Readonly<Record<Lane, readonly DropKind[]>> = {
  queued: [],
  planning: ['planning'],
  implementing: ['implementing', 'answer-comments'],
  'code-review': ['code-review'],
  qa: ['qa'],
  'create-pr': [],
  done: [],
  'review-only': ['review-only'],
  'qa-only': ['qa-only'],
  'pr-only': ['pr-only'],
  'comments-only': ['comments-only'],
};

export function laneDropKinds(lane: Lane): readonly DropKind[] {
  return LANE_DROP_KINDS[lane];
}
