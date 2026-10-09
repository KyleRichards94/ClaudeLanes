import { err, ok, type AssignAgentRequest, type AssignAgentResponse, type Effort, type GitDiff, type Model, type Result } from '@agent-lanes/contracts';
import type { Logger } from '../../logging';
import type { TicketRecordStore } from '../../tickets';
import type { DiffService } from '../../worktrees/diff';
import type { LaunchQueue } from '../launch-queue';
import type { TranscriptService } from '../output/transcript';
import type { SessionManager } from '../session-manager';
import type { StageService } from '../stages/stage-service';
import { buildHandOverBrief } from './hand-over-brief';

/**
 * Assign new agent (AL-263, Kyle 2026-10-09: hand over by default). Ends the ticket's session (or
 * drops its queued launch), records it on the ticket as a past session, saves the new model, effort
 * and skills, moves the stage when asked, and starts a new session in the same worktree and branch.
 * Hand over sends the brief as the first turn (`buildHandOverBrief`); Start fresh sends the original
 * job again. The output gets a divider: "New agent · Sonnet · High · handed over".
 */
export interface AssignAgentService {
  assign(request: AssignAgentRequest): Promise<Result<AssignAgentResponse>>;
}

export interface AssignAgentOptions {
  sessions: Pick<SessionManager, 'status' | 'stop'>;
  launches: Pick<LaunchQueue, 'launch' | 'cancel'>;
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  transcripts: Pick<TranscriptService, 'get' | 'appendSystem'>;
  stages: Pick<StageService, 'pendingGate' | 'moveTo'>;
  /** The diff against the base branch for the brief; without it the brief has no diff section. */
  diffs?: Pick<DiffService, 'files'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
}

/** Why the old session stopped, on its pill. */
export const SESSION_REPLACED_MESSAGE = 'Replaced by a new agent';
/** Past sessions kept on a ticket record; the oldest go first. */
export const PAST_SESSIONS_LIMIT = 50;
/** What the "Handed over" bubble says in the output; the brief itself is the session's first turn. */
export const HAND_OVER_ECHO = "Handed over to a new agent with a brief: the ticket, the original job, its stages, the changes against the base branch and the previous agent's last messages.";

const MODEL_WORDS: Readonly<Record<Model, string>> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const EFFORT_WORDS: Readonly<Record<Effort, string>> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' };

/** The output's divider: "New agent · Sonnet · High · handed over" / "… · started fresh". */
export function newAgentLine(request: Pick<AssignAgentRequest, 'model' | 'effort' | 'mode'>): string {
  return `New agent · ${MODEL_WORDS[request.model]} · ${EFFORT_WORDS[request.effort]} · ${request.mode === 'hand-over' ? 'handed over' : 'started fresh'}`;
}

export function createAssignAgentService(options: AssignAgentOptions): AssignAgentService {
  const now = options.now ?? Date.now;

  async function readDiff(ticketId: string): Promise<GitDiff | null> {
    if (!options.diffs) return null;
    try {
      const diff = await options.diffs.files(ticketId, { kind: 'base' });
      return diff.ok ? diff.data : null;
    } catch {
      return null;
    }
  }

  return {
    async assign(request) {
      const { ticketId } = request;
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);

      // The brief is built while the old session's gate and output are still in place.
      const brief =
        request.mode === 'hand-over'
          ? buildHandOverBrief({ record, events: (await options.transcripts.get(ticketId)).events, diff: await readDiff(ticketId), pendingGate: options.stages.pendingGate(ticketId) })
          : null;
      const previousSessionId = options.sessions.status(ticketId).sessionId ?? record.sessionId;

      // The old agent goes first: a queued launch is dropped, a live session is closed.
      options.launches.cancel(ticketId);
      const stopped = await options.sessions.stop(ticketId, { reason: SESSION_REPLACED_MESSAGE });
      if (!stopped.ok) return stopped;

      const saved = await options.tickets.update(ticketId, (current) => ({
        ...current,
        model: request.model,
        effort: request.effort,
        skills: request.skills,
        sessionId: null,
        ...(previousSessionId
          ? {
              pastSessions: [...(current.pastSessions ?? []), { sessionId: previousSessionId, model: current.model, effort: current.effort, endedAt: now(), reason: 'assigned' as const }].slice(
                -PAST_SESSIONS_LIMIT,
              ),
            }
          : {}),
      }));
      if (!saved.ok) return saved;

      if (request.stage && request.stage !== saved.data.stage) {
        const moved = await options.stages.moveTo(ticketId, request.stage, 'the new agent');
        if (!moved.ok) return moved;
      }
      options.transcripts.appendSystem(ticketId, newAgentLine(request));

      const job = brief ?? saved.data.job?.trim() ?? '';
      const started = await options.launches.launch({
        ticketId,
        jobDescription: job || `Continue the work on ${saved.data.title}.`,
        workItem: saved.data.ado ? { id: saved.data.ado.workItemId, title: saved.data.title } : null,
        firstTurnSource: brief ? 'hand-over' : 'launch',
        ...(brief ? { firstTurnEcho: HAND_OVER_ECHO } : {}),
      });
      if (!started.ok) return started;
      options.log?.info(`Ticket ${ticketId}: assigned a new ${request.model} agent (${request.mode})`);
      return ok({ status: started.data, previousSessionId: previousSessionId ?? null });
    },
  };
}
