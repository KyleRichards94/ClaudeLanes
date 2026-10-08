import type { CanUseTool, McpServerConfig, McpServerStatus, Options, PermissionMode, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  SDK_MODEL_IDS,
  err,
  ok,
  type AgentSessionState,
  type AgentSessionStatus,
  type Effort,
  type Err,
  type Model,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { CLAUDE_CONNECTION_ID, type ConnectionsService } from '../connections';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import { ClaudeLaunchError, type ClaudeCredential, type ClaudeLauncher, type ClaudeQuery } from './claude-sdk';
import { buildFirstTurn, type SessionWorkItem } from './first-turn';
import { createInputQueue, type InputQueue } from './input-queue';

/**
 * The session manager (AL-100, design §4 Session manager, §7): one Claude Agent SDK session per
 * ticket, in streaming-input mode, running in the ticket's worktree.
 *
 * Each session is one `query({ prompt: AsyncIterable<SDKUserMessage>, options })`; the app pushes
 * user turns into its input queue (`send`) and reads its messages until the session ends. Sessions
 * share nothing: each has its own process, queue, abort controller and state, keyed by ticket id.
 *
 * The rest of E6 builds on this surface: `send`, `pause` / `resume` (AL-105), `interrupt`, `setModel` /
 * `setEffort` (AL-106), `stop`, `status`, and `subscribe` for everything that reads the stream
 * (output normalisation AL-102, usage AL-113, sub-agents AL-107).
 *
 * Pause (AL-105) interrupts the current turn and holds every message sent afterwards; Resume delivers
 * them in order (or a "continue" turn when there are none).
 */
export interface SessionManager {
  /**
   * Starts the ticket's session, or resumes it when the record has a session id. A new session's
   * first user turn is the job description, the work item and the selected skills. Starting a
   * ticket whose session is live returns its status and changes nothing.
   */
  start(request: SessionStartRequest): Promise<Result<AgentSessionStatus>>;
  /**
   * Queues a user turn on the ticket's live session (D11: `next` waits for the turn, `now` interjects).
   * While the session is paused the message is held until Resume (`held: true`).
   */
  send(ticketId: string, message: SessionMessageInput): Result<{ held: boolean }>;
  /** Pause (AL-105): interrupts the current turn; messages sent from now on wait for `resume`. */
  pause(ticketId: string): Promise<Result<AgentSessionStatus>>;
  /** Resume: delivers the held messages in order, or a "continue" turn when none were sent. */
  resume(ticketId: string): Result<AgentSessionStatus>;
  /** Stops the current turn; the session stays open for the next message. */
  interrupt(ticketId: string): Promise<Result<void>>;
  /** Saves the model on the ticket and, when its session is live, switches the session to it (D10). */
  setModel(ticketId: string, model: Model): Promise<Result<void>>;
  /** Saves the effort on the ticket and, when its session is live, applies it from the next request (D10). */
  setEffort(ticketId: string, effort: Effort): Promise<Result<void>>;
  /** Closes the ticket's session and its `claude` process. Resolves `false` when none was live. */
  stop(ticketId: string): Promise<Result<boolean>>;
  status(ticketId: string): AgentSessionStatus;
  /** The status of every session the app has started since it opened, live or not. */
  list(): AgentSessionStatus[];
  /** The MCP servers of the ticket's live session, as Claude Code reports them (AL-108). */
  mcpServerStatus(ticketId: string): Promise<Result<McpServerStatus[]>>;
  /** Asks the ticket's live session to restart one of its MCP servers (AL-108). */
  reconnectMcpServer(ticketId: string, serverName: string): Promise<Result<void>>;
  /** Every message of every session, tagged with its ticket. Returns an unsubscribe function. */
  subscribe(listener: SessionMessageListener): () => void;
  /** Stops every session (app quit, AL-213). */
  dispose(): Promise<void>;
}

export interface SessionStartRequest {
  ticketId: string;
  /** "What should the agent do?" (artboard 2). Needed for a new session; ignored when resuming. */
  jobDescription?: string;
  /** The work item the launch picked (AL-161); null or absent for a "No ticket" ticket. */
  workItem?: SessionWorkItem | null;
}

export interface SessionMessageInput {
  text: string;
  /** `next` (default) is delivered when the current turn ends; `now` at the next tool boundary (D11). */
  priority?: 'now' | 'next';
  /** False: added to the transcript and sent with the next turn, without starting one (D11, AL-112). */
  shouldQuery?: boolean;
}

/** A session message, with the worktree the session runs in and whether it resumed a saved session. */
export type SessionMessageListener = (event: { ticketId: string; cwd: string; resumed: boolean; message: SDKMessage }) => void;

/** What a session gets from the rest of E6: AL-103's `agent_lanes` server, AL-108's MCP servers, … */
export interface SessionExtras {
  mcpServers?: Record<string, McpServerConfig>;
  /** Tools the session may use without asking (e.g. `mcp__agent_lanes__set_stage`). */
  allowedTools?: string[];
  /** Appended to Claude Code's system prompt (the stage protocol, AL-103). */
  systemPromptAppend?: string;
  /** Sections added to a new session's first user turn. */
  firstTurnAppendix?: string[];
  /** The permission mode (AL-109); `acceptEdits` when absent. */
  permissionMode?: PermissionMode;
  /** Asked for every tool call the mode and `allowedTools` don't settle (AL-109). */
  canUseTool?: CanUseTool;
}

export interface SessionManagerOptions {
  claude: ClaudeLauncher;
  connections: Pick<ConnectionsService, 'get' | 'secret'>;
  tickets: Pick<TicketRecordStore, 'get' | 'update' | 'flush'>;
  emit: Emit;
  log?: Pick<Logger, 'info' | 'warn' | 'debug'>;
  /** Per-session additions, asked for at each start. */
  extras?: (record: TicketRecord) => SessionExtras | Promise<SessionExtras>;
  /** A session ended (stopped or lost): e.g. a stage gate waiting on it closes (AL-104). */
  onEnded?: (ticketId: string, state: 'stopped' | 'lost') => void;
}

interface Session {
  readonly ticketId: string;
  /** The ticket worktree. */
  readonly cwd: string;
  /** Started with `resume`: the conversation has output from before this session. */
  readonly resumed: boolean;
  readonly input: InputQueue<SDKUserMessage>;
  readonly abort: AbortController;
  query: ClaudeQuery | undefined;
  state: AgentSessionState;
  sessionId: string | null;
  message: string | null;
  /** The app asked the session to end, so the stream ending is not a loss. */
  stopping: boolean;
  /** Paused by the user (AL-105): turns ending do not make it idle, and messages wait in `held`. */
  paused: boolean;
  held: SDKUserMessage[];
  /** Settles when the session's message loop has finished. */
  done: Promise<void>;
}

/** Shown when `claude` ends on its own; AL-110 offers Reconnect. */
export const SESSION_ENDED_MESSAGE = 'The Claude Code session ended unexpectedly. The worktree is intact.';
export const CLAUDE_NOT_CONNECTED_MESSAGE = 'Connect Claude in Connections before starting an agent.';
export const CLAUDE_KEY_UNREADABLE_MESSAGE = "The saved Claude API key can't be read on this computer. Replace it in Connections.";
/** The turn Resume sends when nothing was sent while paused (AL-105). */
export const RESUME_MESSAGE = 'Continue where you left off.';

const LIVE_STATES: ReadonlySet<AgentSessionState> = new Set(['starting', 'running', 'idle', 'paused']);

/** The SDK options for a ticket's session (AL-100 scope); `env` and the binary come from the launcher. */
export function sessionOptions(record: TicketRecord, abortController: AbortController, extras: SessionExtras = {}): Omit<Options, 'pathToClaudeCodeExecutable' | 'env'> {
  return {
    cwd: record.worktreePath,
    // Project skills, settings and .mcp.json come from the trusted main checkout (D12).
    projectConfigRoot: record.repo,
    model: SDK_MODEL_IDS[record.model],
    effort: record.effort,
    thinking: { type: 'adaptive' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    abortController,
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(extras.systemPromptAppend ? { append: extras.systemPromptAppend } : {}) },
    // Edits in the ticket's own worktree go ahead (D18) unless the policy says otherwise (AL-109).
    permissionMode: extras.permissionMode ?? 'acceptEdits',
    ...(extras.canUseTool ? { canUseTool: extras.canUseTool } : {}),
    ...(extras.mcpServers && Object.keys(extras.mcpServers).length > 0 ? { mcpServers: extras.mcpServers } : {}),
    ...(extras.allowedTools && extras.allowedTools.length > 0 ? { allowedTools: extras.allowedTools } : {}),
    ...(record.sessionId ? { resume: record.sessionId } : {}),
  };
}

/** A user turn as the SDK's input stream takes it. */
export function userMessage(input: SessionMessageInput): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: input.text },
    parent_tool_use_id: null,
    priority: input.priority ?? 'next',
    ...(input.shouldQuery === false ? { shouldQuery: false } : {}),
  };
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const { claude, connections, tickets, emit, log } = options;
  const sessions = new Map<string, Session>();
  const listeners = new Set<SessionMessageListener>();

  const statusOf = (ticketId: string, session: Session | undefined): AgentSessionStatus =>
    session
      ? { ticketId, state: session.state, sessionId: session.sessionId, message: session.message }
      : { ticketId, state: 'none', sessionId: null, message: null };

  function setState(session: Session, state: AgentSessionState, message: string | null = null): void {
    if (session.state === state && session.message === message) return;
    session.state = state;
    session.message = message;
    emit('agent:status', { ticketId: session.ticketId, state, sessionId: session.sessionId, message });
  }

  /** The credential the Claude connection holds; never an inherited `ANTHROPIC_API_KEY` (D334). */
  async function credential(): Promise<Result<ClaudeCredential>> {
    const summary = await connections.get(CLAUDE_CONNECTION_ID);
    if (summary?.kind !== 'claude') return err('VALIDATION', CLAUDE_NOT_CONNECTED_MESSAGE, { reason: 'claude-not-connected' });
    if (summary.mode === 'login') return ok({ mode: 'login' });
    const apiKey = await connections.secret(CLAUDE_CONNECTION_ID);
    if (apiKey === undefined) return err('VALIDATION', CLAUDE_KEY_UNREADABLE_MESSAGE, { reason: 'claude-key-unreadable' });
    return ok({ mode: 'api-key', apiKey });
  }

  /** Saves a new session id at once, so a crash right after start can still resume it (AL-110). */
  async function rememberSessionId(session: Session, sessionId: string): Promise<void> {
    if (session.sessionId === sessionId) return;
    session.sessionId = sessionId;
    const saved = await tickets.update(session.ticketId, (record) => ({ ...record, sessionId }));
    if (!saved.ok) {
      log?.warn(`Could not save the session id of ticket ${session.ticketId}: ${saved.message}`);
      return;
    }
    const flushed = await tickets.flush(session.ticketId);
    if (!flushed.ok) log?.warn(`Could not write the session id of ticket ${session.ticketId}: ${flushed.message}`);
  }

  function handle(session: Session, message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      void rememberSessionId(session, message.session_id);
    } else if (message.type === 'result' && !session.paused) {
      setState(session, 'idle');
    }
    for (const listener of listeners) {
      try {
        listener({ ticketId: session.ticketId, cwd: session.cwd, resumed: session.resumed, message });
      } catch (error) {
        log?.warn(`A session message listener failed for ticket ${session.ticketId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async function run(session: Session, query: ClaudeQuery): Promise<void> {
    let failure: string | null = null;
    try {
      for await (const message of query) handle(session, message);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    session.input.close();
    if (session.stopping) {
      setState(session, 'stopped');
    } else {
      log?.warn(`The session of ticket ${session.ticketId} ended without being stopped${failure ? `: ${failure}` : ''}`);
      setState(session, 'lost', SESSION_ENDED_MESSAGE);
    }
    options.onEnded?.(session.ticketId, session.stopping ? 'stopped' : 'lost');
    // Make sure the process is gone even when the stream ended on its own.
    query.close();
  }

  function live(ticketId: string): Result<Session> {
    const session = sessions.get(ticketId);
    if (!session || !LIVE_STATES.has(session.state)) {
      return session?.state === 'lost'
        ? err('SESSION_LOST', session.message ?? SESSION_ENDED_MESSAGE)
        : err('VALIDATION', `No agent session is running for ticket ${ticketId}.`);
    }
    return ok(session);
  }

  async function start(request: SessionStartRequest): Promise<Result<AgentSessionStatus>> {
    const { ticketId } = request;
    const existing = sessions.get(ticketId);
    if (existing && LIVE_STATES.has(existing.state)) return ok(statusOf(ticketId, existing));

    const record = await tickets.get(ticketId);
    if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
    const resuming = record.sessionId !== null;
    const job = request.jobDescription?.trim() ?? '';
    if (!resuming && !job) return err('VALIDATION', 'Say what the agent should do before starting it.');

    const session: Session = {
      ticketId,
      cwd: record.worktreePath,
      resumed: resuming,
      input: createInputQueue<SDKUserMessage>(),
      abort: new AbortController(),
      query: undefined,
      state: 'none',
      sessionId: record.sessionId,
      message: null,
      stopping: false,
      paused: false,
      held: [],
      done: Promise.resolve(),
    };
    // A start for the same ticket may have claimed it while the record was read: that one wins.
    const racing = sessions.get(ticketId);
    if (racing && LIVE_STATES.has(racing.state)) return ok(statusOf(ticketId, racing));
    sessions.set(ticketId, session);
    setState(session, 'starting');

    const fail = (result: Err, message: string): Err => {
      session.input.close();
      setState(session, 'stopped', message);
      return result;
    };

    const auth = await credential();
    if (!auth.ok) return fail(auth, auth.message);
    let extras: SessionExtras;
    try {
      extras = (await options.extras?.(record)) ?? {};
    } catch (error) {
      const message = `The agent session could not be prepared: ${error instanceof Error ? error.message : String(error)}`;
      return fail(err('INTERNAL', message), message);
    }

    if (!resuming) {
      session.input.push(
        userMessage({
          text: buildFirstTurn({
            ticketId,
            title: record.title,
            jobDescription: job,
            workItem: request.workItem ?? null,
            skills: record.skills,
            appendix: extras.firstTurnAppendix ?? [],
          }),
        }),
      );
    }

    let query: ClaudeQuery;
    try {
      query = await claude.launch({
        credential: auth.data,
        prompt: session.input,
        options: {
          ...sessionOptions(record, session.abort, extras),
          stderr: (data) => log?.debug(`claude (${ticketId}): ${data.trimEnd()}`),
        },
      });
    } catch (error) {
      const message = error instanceof ClaudeLaunchError || error instanceof Error ? error.message : String(error);
      return fail(err('INTERNAL', message), message);
    }
    if (session.stopping) {
      query.close();
      setState(session, 'stopped');
      return ok(statusOf(ticketId, session));
    }

    session.query = query;
    log?.info(`Started the agent session of ticket ${ticketId}${resuming ? ' (resumed)' : ''}`);
    setState(session, resuming ? 'idle' : 'running');
    session.done = run(session, query);
    return ok(statusOf(ticketId, session));
  }

  async function stopSession(session: Session): Promise<void> {
    session.stopping = true;
    session.input.close();
    session.abort.abort();
    session.query?.close();
    await session.done;
    setState(session, 'stopped');
  }

  return {
    start,

    send(ticketId, message) {
      const found = live(ticketId);
      if (!found.ok) return found;
      const session = found.data;
      if (!message.text.trim()) return err('VALIDATION', 'The message is empty.');
      if (session.paused) {
        session.held.push(userMessage(message));
        return ok({ held: true });
      }
      session.input.push(userMessage(message));
      if (session.state === 'idle' && message.shouldQuery !== false) setState(session, 'running');
      return ok({ held: false });
    },

    async pause(ticketId) {
      const found = live(ticketId);
      if (!found.ok) return found;
      const session = found.data;
      if (session.paused) return ok(statusOf(ticketId, session));
      session.paused = true;
      setState(session, 'paused');
      try {
        await session.query?.interrupt();
      } catch (error) {
        log?.warn(`Could not interrupt ticket ${ticketId} to pause it: ${error instanceof Error ? error.message : String(error)}`);
      }
      return ok(statusOf(ticketId, session));
    },

    resume(ticketId) {
      const found = live(ticketId);
      if (!found.ok) return found;
      const session = found.data;
      if (!session.paused) return ok(statusOf(ticketId, session));
      session.paused = false;
      const held = session.held.splice(0);
      for (const message of held.length > 0 ? held : [userMessage({ text: RESUME_MESSAGE })]) session.input.push(message);
      setState(session, held.length > 0 && held.every((message) => message.shouldQuery === false) ? 'idle' : 'running');
      return ok(statusOf(ticketId, session));
    },

    async interrupt(ticketId) {
      const found = live(ticketId);
      if (!found.ok) return found;
      try {
        await found.data.query?.interrupt();
        return ok(undefined);
      } catch (error) {
        return err('INTERNAL', `The agent could not be interrupted: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async setModel(ticketId, model) {
      const saved = await tickets.update(ticketId, (record) => ({ ...record, model }));
      if (!saved.ok) return saved;
      const session = sessions.get(ticketId);
      if (session && LIVE_STATES.has(session.state)) await session.query?.setModel(SDK_MODEL_IDS[model]);
      return ok(undefined);
    },

    async setEffort(ticketId, effort) {
      const saved = await tickets.update(ticketId, (record) => ({ ...record, effort }));
      if (!saved.ok) return saved;
      const session = sessions.get(ticketId);
      if (session && LIVE_STATES.has(session.state)) await session.query?.applyFlagSettings({ effortLevel: effort });
      return ok(undefined);
    },

    async stop(ticketId) {
      const session = sessions.get(ticketId);
      if (!session || !LIVE_STATES.has(session.state)) return ok(false);
      await stopSession(session);
      log?.info(`Stopped the agent session of ticket ${ticketId}`);
      return ok(true);
    },

    status: (ticketId) => statusOf(ticketId, sessions.get(ticketId)),

    list: () => [...sessions.values()].map((session) => statusOf(session.ticketId, session)),

    async mcpServerStatus(ticketId) {
      const found = live(ticketId);
      if (!found.ok) return found;
      if (!found.data.query) return ok([]);
      try {
        return ok(await found.data.query.mcpServerStatus());
      } catch (error) {
        return err('INTERNAL', `Could not read the MCP servers of ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async reconnectMcpServer(ticketId, serverName) {
      const found = live(ticketId);
      if (!found.ok) return found;
      try {
        await found.data.query?.reconnectMcpServer(serverName);
        return ok(undefined);
      } catch (error) {
        return err('INTERNAL', `Could not reconnect ${serverName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async dispose() {
      await Promise.all([...sessions.values()].filter((session) => LIVE_STATES.has(session.state)).map(stopSession));
    },
  };
}
