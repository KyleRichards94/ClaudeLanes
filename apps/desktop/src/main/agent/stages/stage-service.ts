import { userInfo } from 'node:os';
import {
  err,
  ok,
  type Gate,
  type GateOutcome,
  type Lane,
  type PendingGate,
  type Result,
  type Stage,
  type StageGates,
} from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import type { TicketRecordStore } from '../../tickets';
import { createKeyedQueue } from '../../worktrees/keyed-queue';
import type { TranscriptService } from '../output/transcript';
import { GATE_SUBJECTS, LANE_LABELS, checkStageTransition, gateFor } from './stage-rules';

/**
 * Stage tracking (AL-103, design §7): moves a ticket between lanes when its agent calls `set_stage`,
 * saves the stage on the ticket record (AL-101 stamps the history), and tells the renderer with
 * `agent:stage` so the card moves; `report_activity` updates the card's activity row and progress.
 *
 * Stage gates (AL-104, design §9 step 2): when the move waits on a gate the ticket has set to "Needs
 * approval", `setStage` does not resolve until the user decides. The agent's tool call stays open
 * meanwhile, so the session sends no request and uses no tokens; the card shows "Needs you"
 * (`agent:gate`). Approve lets the move happen; Request changes returns the user's note instead.
 */
export interface StageService {
  /** The agent's `set_stage`: checked against the stage rules and the ticket's gates, then saved and shown. */
  setStage(ticketId: string, stage: Stage, summary: string, options?: { signal?: AbortSignal }): Promise<Result<StageChange>>;
  /** The agent's `report_activity`; `progress` is 0 to 1. */
  reportActivity(ticketId: string, text: string, progress: number | null): Promise<Result<void>>;
  /** A session is starting: a Queued ticket moves to Planning (design §9 step 1). */
  sessionStarting(ticketId: string): Promise<void>;

  /** The user's decision on the ticket's waiting gate (`agent:resolveGate`). False when none waits. */
  resolveGate(ticketId: string, decision: GateDecision): boolean;
  /** Sets one stage's gate on the ticket; switching off the gate that waits lets the move through (`agent:setGate`). */
  setGate(ticketId: string, stage: Stage, gate: Gate): Promise<Result<{ gates: StageGates; released: boolean }>>;
  /** The gate waiting for the user, if any (`agent:getGate`). */
  pendingGate(ticketId: string): PendingGate | null;
  /** The session ended while a gate waited: the gate closes and the waiting call returns. */
  cancelGate(ticketId: string): void;
}

export type GateDecision = { approve: true } | { approve: false; note: string };

export interface StageChange {
  from: Lane;
  to: Lane;
  /** False when the ticket did not move: it was already there, or the gate was not approved. */
  changed: boolean;
  /** How the gate the move waited on ended; absent when it was not gated. */
  gate?: { stage: Stage; outcome: GateOutcome; note: string | null; by: string | null };
}

/** A saved lane change, for listeners such as the ADO write-back (AL-115). */
export interface StageChangedEvent {
  ticketId: string;
  from: Lane;
  to: Lane;
  /** When the ticket entered `to` (its stage history entry). */
  at: number;
  /** The one-line summary shown as the card's activity; null when none. */
  summary: string | null;
  gate?: { stage: Stage; by: string | null };
}

export interface StageServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  emit: Emit;
  transcripts?: Pick<TranscriptService, 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  /**
   * A ticket entered another lane, after it was saved and shown: the ADO write-back posts its comment
   * (AL-115). `gate` is the gate the move waited on and who approved it.
   */
  onStageChanged?: (change: StageChangedEvent) => void;
  /** Who approves on this computer, for "Plan approved by Kyle". The OS user's first name by default. */
  userName?: () => string;
  now?: () => number;
}

interface Waiting {
  gate: PendingGate;
  settle: (outcome: { outcome: GateOutcome; note: string | null; by: string | null }) => void;
}

/** `Kyle.Richards` → `Kyle`. */
export function firstName(user: string): string {
  const first = user.split(/[\s._@-]+/).find(Boolean) ?? user;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'you';
}

function osUserName(): string {
  try {
    return firstName(userInfo().username);
  } catch {
    return 'you';
  }
}

/** One line on the card; the agent's summary may be longer. */
function oneLine(text: string, limit = 300): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

export const DEFAULT_CHANGES_NOTE = 'The user asked for changes without a note.';

export function createStageService(options: StageServiceOptions): StageService {
  const { tickets, emit } = options;
  const now = options.now ?? Date.now;
  const userName = options.userName ?? osUserName;
  // Stage moves of one ticket happen one at a time, so two calls at once cannot both pass the check.
  const queue = createKeyedQueue();
  const waiting = new Map<string, Waiting>();

  async function move(
    ticketId: string,
    to: Lane,
    summary: string | null,
    systemLine?: string,
    gate?: StageChangedEvent['gate'],
  ): Promise<Result<StageChange>> {
    const saved = await tickets.update(ticketId, (record) => ({ ...record, stage: to }));
    if (!saved.ok) return saved;
    const from = saved.data.stageHistory.at(-2)?.stage ?? to;
    const activity = summary ? oneLine(summary) : null;
    emit('agent:stage', { ticketId, change: 'stage', stage: to, from, activity, progress: 0 });
    options.transcripts?.appendSystem(ticketId, systemLine ?? `Moved to ${LANE_LABELS[to]}${activity ? ` · ${activity}` : ''}`);
    options.log?.info(`Ticket ${ticketId} moved from ${from} to ${to}`);
    try {
      const at = saved.data.stageHistory.at(-1)?.at ?? now();
      options.onStageChanged?.({ ticketId, from, to, at, summary: activity, ...(gate ? { gate } : {}) });
    } catch (error) {
      options.log?.warn(`A stage change listener failed for ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return ok({ from, to, changed: true });
  }

  function emitGate(ticketId: string, gate: PendingGate, state: 'waiting' | GateOutcome, note: string | null): void {
    emit('agent:gate', { ticketId, state, stage: gate.stage, from: gate.from, to: gate.to, summary: gate.summary, note });
  }

  /** Waits for the user's decision on the gate; the call's abort signal (the turn was interrupted) cancels it. */
  function waitForDecision(ticketId: string, gate: PendingGate, signal?: AbortSignal): Promise<{ outcome: GateOutcome; note: string | null; by: string | null }> {
    return new Promise((resolve) => {
      const onAbort = () => close({ outcome: 'cancelled', note: null, by: null });
      function close(result: { outcome: GateOutcome; note: string | null; by: string | null }) {
        if (waiting.get(ticketId)?.gate !== gate) return;
        waiting.delete(ticketId);
        signal?.removeEventListener('abort', onAbort);
        emitGate(ticketId, gate, result.outcome, result.note);
        resolve(result);
      }
      waiting.set(ticketId, { gate, settle: close });
      emitGate(ticketId, gate, 'waiting', null);
      options.transcripts?.appendSystem(ticketId, `Waiting for approval · ${GATE_SUBJECTS[gate.stage]} before ${LANE_LABELS[gate.to]}`);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function gatedMove(ticketId: string, from: Lane, to: Stage, gateStage: Stage, summary: string, signal?: AbortSignal): Promise<Result<StageChange>> {
    const gate: PendingGate = { stage: gateStage, from, to, summary: oneLine(summary) || null, openedAt: now() };
    const decision = await waitForDecision(ticketId, gate, signal);
    const subject = GATE_SUBJECTS[gateStage];
    const result = { stage: gateStage, ...decision };
    if (decision.outcome === 'approved') {
      const by = decision.by ? ` by ${decision.by}` : ' (gate switched off)';
      const moved = await move(ticketId, to, summary, `${subject} approved${by} · moved to ${LANE_LABELS[to]}`, {
        stage: gateStage,
        by: decision.by,
      });
      return moved.ok ? ok({ ...moved.data, gate: result }) : moved;
    }
    if (decision.outcome === 'changes-requested') {
      options.transcripts?.appendSystem(ticketId, `Changes requested by ${decision.by ?? 'the user'} · ${decision.note ?? DEFAULT_CHANGES_NOTE}`);
    }
    return ok({ from, to: from, changed: false, gate: result });
  }

  return {
    setStage: (ticketId, stage, summary, callOptions = {}) =>
      queue(ticketId, async () => {
        const record = await tickets.get(ticketId);
        if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
        const check = checkStageTransition(record.stage, stage);
        if (!check.ok) return err('VALIDATION', check.reason);
        if (!check.changed) return ok({ from: record.stage, to: stage, changed: false });
        const gateStage = gateFor(record.gates, record.stage, stage);
        if (gateStage) return gatedMove(ticketId, record.stage, stage, gateStage, summary, callOptions.signal);
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

    resolveGate(ticketId, decision) {
      const pending = waiting.get(ticketId);
      if (!pending) return false;
      const by = userName();
      if (decision.approve) pending.settle({ outcome: 'approved', note: null, by });
      else pending.settle({ outcome: 'changes-requested', note: decision.note.trim() || DEFAULT_CHANGES_NOTE, by });
      return true;
    },

    async setGate(ticketId, stage, gate) {
      const saved = await tickets.update(ticketId, (record) => ({ ...record, gates: { ...record.gates, [stage]: gate } }));
      if (!saved.ok) return saved;
      const pending = waiting.get(ticketId);
      const released = gate === 'auto' && pending?.gate.stage === stage;
      if (released) pending.settle({ outcome: 'approved', note: null, by: null });
      return ok({ gates: saved.data.gates, released });
    },

    pendingGate: (ticketId) => waiting.get(ticketId)?.gate ?? null,

    cancelGate(ticketId) {
      waiting.get(ticketId)?.settle({ outcome: 'cancelled', note: null, by: null });
    },
  };
}
