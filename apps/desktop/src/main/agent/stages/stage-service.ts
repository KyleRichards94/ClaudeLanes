import { err, ok, type Lane, type Result, type Stage } from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import type { TicketRecordStore } from '../../tickets';
import { createKeyedQueue } from '../../worktrees/keyed-queue';
import type { TranscriptService } from '../output/transcript';
import { LANE_LABELS, checkStageTransition } from './stage-rules';

/**
 * Stage tracking (AL-103, design §7): moves a ticket between lanes when its agent calls `set_stage`,
 * saves the stage on the ticket record (AL-101 stamps the history), and tells the renderer with
 * `agent:stage` so the card moves; `report_activity` updates the card's activity row and progress.
 */
export interface StageService {
  /** The agent's `set_stage`: checked against the stage rules, then saved and shown. */
  setStage(ticketId: string, stage: Stage, summary: string): Promise<Result<StageChange>>;
  /** The agent's `report_activity`; `progress` is 0 to 1. */
  reportActivity(ticketId: string, text: string, progress: number | null): Promise<Result<void>>;
  /** A session is starting: a Queued ticket moves to Planning (design §9 step 1). */
  sessionStarting(ticketId: string): Promise<void>;
}

export interface StageChange {
  from: Lane;
  to: Lane;
  /** False when the ticket was already in that stage. */
  changed: boolean;
}

export interface StageServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  emit: Emit;
  transcripts?: Pick<TranscriptService, 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
}

/** One line on the card; the agent's summary may be longer. */
function oneLine(text: string, limit = 300): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

export function createStageService(options: StageServiceOptions): StageService {
  const { tickets, emit } = options;
  // Stage moves of one ticket happen one at a time, so two calls at once cannot both pass the check.
  const queue = createKeyedQueue();

  async function move(ticketId: string, to: Lane, summary: string | null): Promise<Result<StageChange>> {
    const saved = await tickets.update(ticketId, (record) => ({ ...record, stage: to }));
    if (!saved.ok) return saved;
    const from = saved.data.stageHistory.at(-2)?.stage ?? to;
    const activity = summary ? oneLine(summary) : null;
    emit('agent:stage', { ticketId, change: 'stage', stage: to, from, activity, progress: 0 });
    options.transcripts?.appendSystem(ticketId, `Moved to ${LANE_LABELS[to]}${activity ? ` · ${activity}` : ''}`);
    options.log?.info(`Ticket ${ticketId} moved from ${from} to ${to}`);
    return ok({ from, to, changed: true });
  }

  return {
    setStage: (ticketId, stage, summary) =>
      queue(ticketId, async () => {
        const record = await tickets.get(ticketId);
        if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
        const check = checkStageTransition(record.stage, stage);
        if (!check.ok) return err('VALIDATION', check.reason);
        if (!check.changed) return ok({ from: record.stage, to: stage, changed: false });
        return move(ticketId, stage, summary);
      }),

    async reportActivity(ticketId, text, progress) {
      const activity = oneLine(text);
      if (!activity) return err('VALIDATION', 'Say what you are doing in a few words.');
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const clamped = progress === null || !Number.isFinite(progress) ? null : Math.min(1, Math.max(0, progress));
      emit('agent:stage', { ticketId, change: 'activity', stage: record.stage, from: null, activity, progress: clamped });
      return ok(undefined);
    },

    sessionStarting: (ticketId) =>
      queue(ticketId, async () => {
        const record = await tickets.get(ticketId);
        if (record?.stage !== 'queued') return;
        const moved = await move(ticketId, 'planning', null);
        if (!moved.ok) options.log?.warn(`Could not move ticket ${ticketId} to Planning: ${moved.message}`);
      }),
  };
}
