import type { Gate, ReviewStatus, Stage, StageGates } from '@agent-lanes/contracts';
import type { Turn, TurnStage } from '@/entities/turn';
import { LANE_LABELS } from '@/shared/config';
import { countOf, formatCost, formatDuration } from '../lib/format';

/** One step of the ticket's workflow as the page works it out (`stageSteps`): its state, and how long a finished one took. */
export interface StageStepInput {
  readonly stage: Stage;
  readonly state: 'done' | 'current' | 'upcoming';
  readonly durationMs: number | null;
}

/** Files the reviewer has finished (passed, or with changes requested) out of the files changed. */
export interface ReviewProgress {
  readonly reviewed: number;
  readonly total: number;
}

export interface WorkflowInput {
  readonly steps: readonly StageStepInput[];
  readonly gates: StageGates;
  /** The stage whose gate waits for the user; its card turns amber. */
  readonly waitingStage: Stage | null;
  /** The ticket's turns, to count each stage's turns and cost. */
  readonly turns: readonly Turn[];
  /** The current stage's progress as the agent reports it (0 to 1); null when it has not. */
  readonly progress: number | null;
  /** The reviewer's progress through the diff, for Code review. */
  readonly review: ReviewProgress | null;
}

export type GateChipTone = 'ok' | 'attention' | 'neutral';

export interface WorkflowStage {
  readonly stage: Stage;
  /** 1-based, shown in the dot until the stage is done. */
  readonly number: number;
  readonly label: string;
  readonly state: StageStepInput['state'];
  readonly gate: Gate;
  /** "Approved" (a finished stage that needed approval), "Approval" (one that does or will), "Auto". */
  readonly gateLabel: 'Approved' | 'Approval' | 'Auto';
  readonly gateTone: GateChipTone;
  readonly waiting: boolean;
  /** Done: "12m · 3 turns · $0.84". Current: its progress line. Upcoming: what happens next. */
  readonly meta: string;
  /** The current stage's progress, 0 to 1; null while it is not known (an indeterminate bar). Null for the other stages. */
  readonly progress: number | null;
  /** What the card is named for assistive technology: "Planning, done, 12m". */
  readonly name: string;
}

/** The turn strip's stage names for the five stages. */
export const TURN_STAGE_OF: Readonly<Record<Stage, TurnStage>> = {
  planning: 'planning',
  implementing: 'implementing',
  'code-review': 'codeReview',
  qa: 'qa',
  'create-pr': 'createPr',
};

/** What a stage that has not started will do (when its gate is not Approval). */
const NEXT_UP: Readonly<Record<Stage, string>> = {
  planning: 'writes the plan',
  implementing: 'builds the plan',
  'code-review': 'reviews the diff',
  qa: 'QA runs next',
  'create-pr': 'opens the pull request',
};

const STATE_WORDS: Readonly<Record<StageStepInput['state'], string>> = { done: 'done', current: 'current stage', upcoming: 'upcoming' };

/** Files the reviewer has finished, from `diff:files`' per-file review status. */
export function reviewProgress(paths: readonly string[], status: Readonly<Record<string, ReviewStatus>>): ReviewProgress {
  const reviewed = paths.filter((path) => status[path] === 'passed' || status[path] === 'changesRequested').length;
  return { reviewed, total: paths.length };
}

/** A stage's turns and what they cost (a turn belongs to the stage it started in). */
export function stageTurns(turns: readonly Turn[], stage: Stage): { count: number; costUsd: number } {
  const inStage = turns.filter((turn) => turn.stage === TURN_STAGE_OF[stage]);
  return { count: inStage.length, costUsd: inStage.reduce((sum, turn) => sum + turn.costUsd, 0) };
}

/** The meta line of a finished stage, "12m · 3 turns · $0.84", with the parts it has. */
export function doneMeta(durationMs: number | null, turns: { count: number; costUsd: number }): string {
  const parts: string[] = [];
  if (durationMs !== null) parts.push(formatDuration(durationMs));
  if (turns.count > 0) parts.push(countOf(turns.count, 'turn'), formatCost(turns.costUsd));
  return parts.length > 0 ? parts.join(' · ') : 'Done';
}

const percent = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

/**
 * The five stage cards of the workflow card (handoff "Flight deck > Workflow card"). Done stages say how long
 * they took and what they cost; the current one has a progress line and a bar (Code review: files reviewed over
 * files changed; the others: the progress the agent reports, else none, which is an indeterminate bar); the ones
 * to come say what happens next, or that they wait for the user.
 */
export function workflowStages({ steps, gates, waitingStage, turns, progress, review }: WorkflowInput): WorkflowStage[] {
  return steps.map((step, index): WorkflowStage => {
    const gate = gates[step.stage];
    const waiting = waitingStage === step.stage;
    const label = LANE_LABELS[step.stage];

    let stageProgress: number | null = null;
    let meta: string;
    if (step.state === 'done') {
      meta = doneMeta(step.durationMs, stageTurns(turns, step.stage));
    } else if (step.state === 'current') {
      if (step.stage === 'code-review' && review !== null && review.total > 0) {
        stageProgress = review.reviewed / review.total;
        meta = `${review.reviewed} of ${countOf(review.total, 'file')} reviewed`;
      } else if (progress !== null) {
        stageProgress = Math.min(1, Math.max(0, progress));
        meta = `${percent(stageProgress)} done`;
      } else {
        meta = 'Working…';
      }
      if (waiting) meta = 'Waiting for your approval';
    } else {
      meta = gate === 'approval' ? 'waits for you' : NEXT_UP[step.stage];
    }

    const detail =
      step.state === 'done' ? (step.durationMs !== null ? formatDuration(step.durationMs) : null) : stageProgress !== null ? percent(stageProgress) : null;
    return {
      stage: step.stage,
      number: index + 1,
      label,
      state: step.state,
      gate,
      gateLabel: gate === 'approval' ? (step.state === 'done' ? 'Approved' : 'Approval') : 'Auto',
      gateTone: gate === 'approval' ? (step.state === 'done' ? 'ok' : 'attention') : 'neutral',
      waiting,
      meta,
      progress: stageProgress,
      name: `${label}, ${STATE_WORDS[step.state]}${detail ? `, ${detail}` : ''}${waiting ? ', waiting for approval' : ''}`,
    };
  });
}
