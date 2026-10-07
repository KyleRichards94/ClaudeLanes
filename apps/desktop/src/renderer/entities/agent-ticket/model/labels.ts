import type { Effort, Lane, Model } from '@agent-lanes/contracts';

/**
 * How lanes, models and efforts are written in the UI (artboards 1–4, 6): "Code review",
 * "Opus · XHigh". One place, so the board, the drill-in and the design tab agree.
 */

export const LANE_LABELS: Readonly<Record<Lane, string>> = {
  queued: 'Queued',
  planning: 'Planning',
  implementing: 'Implementing',
  'code-review': 'Code review',
  qa: 'QA',
  'create-pr': 'Create PR',
  done: 'Done',
};

export const MODEL_LABELS: Readonly<Record<Model, string>> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

export const EFFORT_LABELS: Readonly<Record<Effort, string>> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

/** "Opus · XHigh". */
export function modelEffortLabel(model: Model, effort: Effort): string {
  return `${MODEL_LABELS[model]} · ${EFFORT_LABELS[effort]}`;
}

/** "Implementing · 46%" while progress is known, else "Implementing". */
export function stageProgressLabel(stage: Lane, progress: number | null): string {
  const label = LANE_LABELS[stage];
  return progress === null || stage === 'queued' || stage === 'done' ? label : `${label} · ${Math.round(progress * 100)}%`;
}
