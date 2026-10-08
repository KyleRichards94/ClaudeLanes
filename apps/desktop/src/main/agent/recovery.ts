import { err, ok, type AgentSessionStatus, type Result } from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { SessionEndInfo, SessionManager } from './session-manager';

/**
 * Crash recovery (AL-110, design §12: "A crashed Claude session is restarted from its saved session
 * id in the same worktree. The worktree is never deleted automatically."). A lost session (its stream
 * failed, its process exited, or the watchdog found it silent while running) is resumed once on its
 * own: a new `query()` with `resume: <session id>` and the same cwd, so the conversation and the
 * worktree are as they were. If that fails, or the session is lost again soon after, the user gets
 * the artboard 6 toast "MCP bridge lost the session" with Reconnect / Dismiss.
 */
export interface SessionRecovery {
  /** The session manager's `onEnded`: reacts to a lost session. */
  onEnded(ticketId: string, state: 'stopped' | 'lost', info?: SessionEndInfo): void;
  /** Reconnect (`agent:reconnect`, the toast's button): resumes the ticket's saved session in its worktree. */
  reconnect(ticketId: string): Promise<Result<AgentSessionStatus>>;
}

export interface SessionRecoveryOptions {
  sessions: Pick<SessionManager, 'start' | 'send' | 'status'>;
  emit: Emit;
  log?: Pick<Logger, 'info' | 'warn'>;
  /** A loss within this long of the last automatic retry asks the user instead of retrying again. */
  retryWindowMs?: number;
  now?: () => number;
}

export const SESSION_LOST_TITLE = 'MCP bridge lost the session';
/** Sent to a session resumed after it was lost mid-turn, so it carries on with the turn it lost. */
export const RECOVERED_MESSAGE =
  'Agent Lanes restarted this session after the Claude Code process stopped responding. Continue the task where you left off; check the worktree first if you were in the middle of an edit.';
export const RETRY_WINDOW_MS = 10 * 60_000;

export function sessionLostToastId(ticketId: string): string {
  return `session-lost:${ticketId}`;
}

export function createSessionRecovery(options: SessionRecoveryOptions): SessionRecovery {
  const { sessions, emit, log } = options;
  const now = options.now ?? Date.now;
  const retryWindowMs = options.retryWindowMs ?? RETRY_WINDOW_MS;
  /** When each ticket was last retried automatically. */
  const retriedAt = new Map<string, number>();
  /** Whether each lost session was in the middle of a turn. */
  const midTurn = new Map<string, boolean>();

  function askUser(ticketId: string, reason: string | null): void {
    emit('toast', {
      id: sessionLostToastId(ticketId),
      tone: 'error',
      title: SESSION_LOST_TITLE,
      body: reason ? `${ticketId} stopped responding. The worktree is intact. ${reason}` : `${ticketId} stopped responding. The worktree is intact.`,
      actions: [{ label: 'Reconnect', intent: { type: 'reconnectSession', ticketId } }],
    });
  }

  async function reconnect(ticketId: string): Promise<Result<AgentSessionStatus>> {
    const state = sessions.status(ticketId).state;
    if (state !== 'lost' && state !== 'stopped') return ok(sessions.status(ticketId));
    if (!sessions.status(ticketId).sessionId) {
      return err('SESSION_LOST', `${ticketId} has no saved session to resume. Start it again from the board.`);
    }
    const started = await sessions.start({ ticketId });
    if (!started.ok) return started;
    if (midTurn.get(ticketId)) {
      midTurn.delete(ticketId);
      const sent = sessions.send(ticketId, { text: RECOVERED_MESSAGE });
      if (!sent.ok) log?.warn(`Could not ask the resumed session of ticket ${ticketId} to continue: ${sent.message}`);
    }
    log?.info(`Resumed the lost session of ticket ${ticketId}`);
    return ok(sessions.status(ticketId));
  }

  async function autoRetry(ticketId: string): Promise<void> {
    retriedAt.set(ticketId, now());
    const resumed = await reconnect(ticketId);
    if (!resumed.ok) askUser(ticketId, resumed.message);
  }

  return {
    onEnded(ticketId, state, info) {
      if (state !== 'lost') return;
      midTurn.set(ticketId, info?.midTurn ?? false);
      const last = retriedAt.get(ticketId);
      if (last !== undefined && now() - last < retryWindowMs) {
        log?.warn(`The session of ticket ${ticketId} was lost again after an automatic retry; asking the user`);
        askUser(ticketId, null);
        return;
      }
      log?.warn(`The session of ticket ${ticketId} was lost; resuming it once`);
      void autoRetry(ticketId);
    },
    reconnect,
  };
}
