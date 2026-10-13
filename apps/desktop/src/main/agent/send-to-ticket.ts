import { err, ok, type AgentSessionState, type Result } from '@agent-lanes/contracts';
import type { TicketRecordStore } from '../tickets';
import type { LaunchQueue } from './launch-queue';
import type { SessionRecovery } from './recovery';
import type { SessionManager, SessionMessageInput } from './session-manager';

/** Session states with a `claude` process that takes messages. */
export const LIVE_SESSION_STATES: ReadonlySet<AgentSessionState> = new Set(['starting', 'running', 'idle', 'paused']);

const QUEUED_MESSAGE = 'The agent is waiting for a free slot; send again once it has started.';

export interface SendToTicketDeps {
  sessions: Pick<SessionManager, 'send'>;
  launches: Pick<LaunchQueue, 'status' | 'launch'>;
  recovery: Pick<SessionRecovery, 'reconnect'>;
  tickets: Pick<TicketRecordStore, 'update'>;
}

/**
 * Gives a ticket's agent a message (AL-268): a live session takes it; an ended or lost one is resumed
 * first; one the SDK will not resume, or that never ran, starts fresh with the message as its job.
 */
export function createSendToTicket({ sessions, launches, recovery, tickets }: SendToTicketDeps) {
  return async (ticketId: string, message: SessionMessageInput): Promise<Result<{ held: boolean }>> => {
    const status = launches.status(ticketId);
    if (LIVE_SESSION_STATES.has(status.state)) return sessions.send(ticketId, message);
    if (status.state === 'queued') return err('VALIDATION', QUEUED_MESSAGE);
    if (status.sessionId) {
      const resumed = await recovery.reconnect(ticketId);
      if (resumed.ok) return resumed.data.state === 'queued' ? err('VALIDATION', QUEUED_MESSAGE) : sessions.send(ticketId, message);
      // The SDK would not resume it (its session file is gone): a fresh session takes the message as its job.
      const cleared = await tickets.update(ticketId, (record) => ({ ...record, sessionId: null }));
      if (!cleared.ok) return cleared;
    }
    const started = await launches.launch({ ticketId, jobDescription: message.text, ...(message.source ? { firstTurnSource: message.source } : {}), firstTurnEcho: message.text });
    return started.ok ? ok({ held: false }) : started;
  };
}

export type SendToTicket = ReturnType<typeof createSendToTicket>;
