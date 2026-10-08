import type { Effort, Lane, Model, Stage } from '@agent-lanes/contracts';

/**
 * How the app writes the shared vocabulary (contracts `vocabulary.ts`) on screen: model cards and
 * card footers ("Opus · XHigh"), effort segments (Low / Med / High / XHigh / Max) and lane names
 * (artboards 1 and 2).
 */
export const MODEL_LABELS: Readonly<Record<Model, string>> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };

/** The line under each model card's name (artboard 2). */
export const MODEL_TAGLINES: Readonly<Record<Model, string>> = {
  opus: 'Deepest reasoning',
  sonnet: 'Balanced',
  haiku: 'Fast + light',
};

export const EFFORT_LABELS: Readonly<Record<Effort, string>> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

export const LANE_LABELS: Readonly<Record<Lane, string>> = {
  queued: 'Queued',
  planning: 'Planning',
  implementing: 'Implementing',
  'code-review': 'Code review',
  qa: 'QA',
  'create-pr': 'Create PR',
  done: 'Done',
};

export function stageLabel(stage: Stage): string {
  return LANE_LABELS[stage];
}

/** "Opus · XHigh". */
export function modelEffortLabel(model: Model, effort: Effort): string {
  return `${MODEL_LABELS[model]} · ${EFFORT_LABELS[effort]}`;
}
