import { STAGES, type Lane, type Stage, type TicketStageEntry } from '@agent-lanes/contracts';

export interface StageStep {
  readonly stage: Stage;
  readonly state: 'done' | 'current' | 'upcoming';
  /** How long the stage took, for a finished one ("Planning 12m"); null when unknown or not finished. */
  readonly durationMs: number | null;
}

/**
 * The five steps of the drill-in's stepper (artboard 3): stages before the current lane are done,
 * the current one is current, the rest upcoming. Queued has every stage upcoming; Done has every
 * stage done. A stage's duration runs from its last entry to the entry after it in the history.
 */
export function stageSteps(lane: Lane, history: readonly TicketStageEntry[]): StageStep[] {
  const currentIndex = lane === 'queued' ? -1 : lane === 'done' ? STAGES.length : STAGES.indexOf(lane);

  return STAGES.map((stage, index) => {
    const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
    let durationMs: number | null = null;
    if (state === 'done') {
      const entryIndex = history.findLastIndex((entry) => entry.stage === stage);
      const next = entryIndex >= 0 ? history[entryIndex + 1] : undefined;
      const entry = history[entryIndex];
      if (entry && next) durationMs = Math.max(0, next.at - entry.at);
    }
    return { stage, state, durationMs };
  });
}

/** When the session started working: the first entry into a stage after Queued; null while queued. */
export function sessionStartedAt(history: readonly TicketStageEntry[]): number | null {
  return history.find((entry) => entry.stage !== 'queued')?.at ?? null;
}
