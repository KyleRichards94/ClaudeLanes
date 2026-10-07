import type { Lane, Stage } from '@agent-lanes/contracts';

/**
 * Which stage moves an agent may make with `set_stage` (AL-103, design §9 diagram):
 * Planning → Implementing → Code review → QA → Create PR, one step at a time, and Code review or QA
 * may send the work back to Implementing. Queued and Done are the app's: a session starting moves
 * Queued → Planning, and a merge or closed PR moves the card to Done.
 */

/** How lanes are named to the user and the agent (artboard 1). */
export const LANE_LABELS: Record<Lane, string> = {
  queued: 'Queued',
  planning: 'Planning',
  implementing: 'Implementing',
  'code-review': 'Code review',
  qa: 'QA',
  'create-pr': 'Create PR',
  done: 'Done',
};

const NEXT: Record<Lane, readonly Stage[]> = {
  queued: ['planning'],
  planning: ['implementing'],
  implementing: ['code-review'],
  'code-review': ['qa', 'implementing'],
  qa: ['create-pr', 'implementing'],
  'create-pr': [],
  done: [],
};

/** Stages `set_stage` may move a ticket in `from` to. */
export function allowedNextStages(from: Lane): readonly Stage[] {
  return NEXT[from];
}

export type StageTransitionCheck =
  | { ok: true; changed: boolean }
  /** `reason` is written for the agent, which reads it as the tool's error. */
  | { ok: false; reason: string };

export function checkStageTransition(from: Lane, to: Stage): StageTransitionCheck {
  if (from === to) return { ok: true, changed: false };
  const next = NEXT[from];
  if (next.includes(to)) return { ok: true, changed: true };
  const allowed = next.length === 0 ? 'no other stage' : next.map((stage) => `"${stage}" (${LANE_LABELS[stage]})`).join(' or ');
  return {
    ok: false,
    reason: `Cannot move from ${LANE_LABELS[from]} to ${LANE_LABELS[to]}. From ${LANE_LABELS[from]} you can move to ${allowed}. Stages go one step forward at a time; Code review and QA may send the work back to Implementing.`,
  };
}
