import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CanUseTool, PermissionResult, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  DESIGN_THREAD_HISTORY_MAX,
  DESIGN_THREAD_TEXT_MAX,
  DesignThreadMessageSchema,
  err,
  ok,
  type DesignCanvasRef,
  type DesignThread,
  type DesignThreadApproval,
  type DesignThreadMessage,
  type DesignThreadStatus,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { tokens } from '@agent-lanes/tokens';
import type { ClaudeLauncher, ClaudeQuery } from '../agent/claude-sdk';
import { createInputQueue, type InputQueue } from '../agent/input-queue';
import type { Emit } from '../ipc/emit';
import { errnoCode, nodeRecordFs, writeFileAtomic, type RecordFs } from '../tickets/atomic-file';
import type { TicketRecordStore } from '../tickets';
import { createKeyedQueue } from '../worktrees/keyed-queue';
import { CLAUDE_DESIGN_READ_OPERATIONS, UNAVAILABLE_REASON } from './artboards';

/**
 * The ticket's in-app design thread (AL-196, R11, D120): a per-ticket design session (an Agent SDK
 * session allowed only the tool that reads that kind of canvas, D118) the user talks to from the design
 * tab at any stage, while the lead agent keeps running.
 *
 * - **Separate from the lead agent.** Its own `claude` process, its own input queue and no gate: a
 *   message here never reaches the implementation agent (that is AL-197's ship), and nothing the lead
 *   agent does waits on it, or it on the agent.
 * - **History survives restarts.** Messages and the session id are saved in
 *   `<userData>/design-threads/<ticketId>.json` (D8: app data, never the worktree); the next message
 *   after a restart resumes the same session, so it still knows the conversation.
 * - **Writes need the user (D121).** Reads are allowed; a canvas change (ClaudeDesign `finalize_plan`,
 *   or a write without the plan token an approved plan gave it) waits in the thread for Approve or
 *   Decline.
 * - **Degrades clearly (D119).** When the session's `system/init` does not offer the design tool, the
 *   thread is `unavailable` with the reason, instead of failing.
 */
export interface DesignThreadService {
  get(ticketId: string): Promise<Result<DesignThread>>;
  send(ticketId: string, text: string): Promise<Result<DesignThread>>;
  answer(ticketId: string, approvalId: string, approve: boolean): Promise<Result<DesignThread>>;
  /** Stops every design session (on quit); the saved history stays. */
  dispose(): Promise<void>;
}

export interface DesignThreadServiceOptions {
  claude: ClaudeLauncher;
  tickets: Pick<TicketRecordStore, 'get'>;
  emit: Emit;
  /** `<userData>/design-threads`; also the design sessions' working folder, so a resumed session is found. */
  dir: string;
  /** The model the design session talks with (D10's Sonnet). */
  model?: string;
  fs?: RecordFs;
  now?: () => number;
  newId?: () => string;
  warn?: (message: string) => void;
}

export const DESIGN_THREADS_DIR_NAME = 'design-threads';
export const DESIGN_THREAD_MODEL = 'claude-sonnet-5-5';

/** `<userData>/design-threads`. */
export function designThreadsDir(appDataDir: string): string {
  return join(appDataDir, DESIGN_THREADS_DIR_NAME);
}

const TOOL_BY_KIND: Record<DesignCanvasRef['kind'], string> = { 'design-project': 'ClaudeDesign', artifact: 'Artifact' };

/** Artifact tool actions that only read (the SDK's `ArtifactInput.action`); anything else asks the user. */
export const ARTIFACT_READ_ACTIONS = new Set(['list', 'read', 'list_types', 'status', 'list_assets', 'read_asset']);

const SUMMARY_MAX = 1_500;

const SavedThreadSchema = z.object({
  version: z.literal(1),
  ticketId: z.string(),
  /** The design session to resume; null before the first reply. */
  sessionId: z.string().nullable(),
  /** The canvas that session was started on; a relinked canvas starts a new session. */
  canvasUrl: z.string().nullable(),
  messages: z.array(DesignThreadMessageSchema).max(DESIGN_THREAD_HISTORY_MAX),
});
type SavedThread = z.infer<typeof SavedThreadSchema>;

interface Session {
  input: InputQueue<SDKUserMessage>;
  abort: AbortController;
  canvasUrl: string;
  query: ClaudeQuery | undefined;
  /** Whether `system/init` arrived; a resume that fails before it drops the saved session id. */
  started: boolean;
  resumed: boolean;
}

interface PendingApproval {
  approval: DesignThreadApproval;
  settle: (approve: boolean) => void;
}

interface Entry {
  ticketId: string;
  saved: SavedThread;
  status: DesignThreadStatus;
  reason: string | null;
  pendingTurns: number;
  session: Session | null;
  approval: PendingApproval | null;
}

export function threadPrompt(record: Pick<TicketRecord, 'id' | 'title'>, canvas: DesignCanvasRef): string {
  const canvasLine =
    canvas.kind === 'design-project'
      ? `The ticket's canvas is the Claude Design project with id "${canvas.id}" (${canvas.url}). Read it with the ClaudeDesign tool (list_files, read_file, get_project).`
      : `The ticket's canvas is the Design artifact at ${canvas.url}. Read it with the Artifact tool.`;
  const changeLine =
    canvas.kind === 'design-project'
      ? 'To change the canvas, propose the change with ClaudeDesign finalize_plan first; the user approves or declines each plan in Agent Lanes. Only write with the plan token an approved plan gives you.'
      : 'Any change to the artifact needs the user, who approves or declines it in Agent Lanes.';
  return [
    `You are the design side of Agent Lanes ticket #${record.id} "${record.title}".`,
    'The user talks to you about the ticket\'s design while a separate implementation agent works on the code. You never message that agent; nothing said here reaches it until the user ships a design.',
    canvasLine,
    changeLine,
    'Read the canvas whenever it helps you answer. Keep replies short and concrete, and name the artboards you mean.',
    `Design-system tokens (agent-lanes-tokens.css): ${JSON.stringify(tokens)}`,
  ].join('\n');
}

function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function hasPlanToken(input: Record<string, unknown>): boolean {
  const args = input['arguments'];
  if (typeof args !== 'object' || args === null) return false;
  const token = (args as Record<string, unknown>)['plan_token'];
  return typeof token === 'string' && token.length > 0;
}

/** What the tool would do, for the approval card: the operation's arguments, readable and short. */
function summarize(tool: string, input: Record<string, unknown>): { operation: string; summary: string } {
  if (tool === 'ClaudeDesign') {
    const args = input['arguments'];
    return { operation: String(input['operation'] ?? 'unknown'), summary: cut(JSON.stringify(args ?? {}, null, 2), SUMMARY_MAX) };
  }
  const { action, ...rest } = input;
  return { operation: String(action ?? 'publish'), summary: cut(JSON.stringify(rest, null, 2), SUMMARY_MAX) };
}

export function createDesignThreadService(options: DesignThreadServiceOptions): DesignThreadService {
  const fs = options.fs ?? nodeRecordFs;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const warn = options.warn ?? (() => undefined);
  const writes = createKeyedQueue();
  const entries = new Map<string, Promise<Entry>>();
  const pendingWrites = new Set<Promise<void>>();
  let disposed = false;

  const fileFor = (ticketId: string) => join(options.dir, `${ticketId}.json`);

  function load(ticketId: string): Promise<Entry> {
    let entry = entries.get(ticketId);
    if (!entry) {
      entry = read(ticketId).then((saved) => ({
        ticketId,
        saved,
        status: 'idle' as DesignThreadStatus,
        reason: null,
        pendingTurns: 0,
        session: null,
        approval: null,
      }));
      entries.set(ticketId, entry);
    }
    return entry;
  }

  async function read(ticketId: string): Promise<SavedThread> {
    const empty: SavedThread = { version: 1, ticketId, sessionId: null, canvasUrl: null, messages: [] };
    const file = fileFor(ticketId);
    let text: string;
    try {
      text = await fs.readFile(file);
    } catch (cause) {
      if (errnoCode(cause) !== 'ENOENT') warn(`Couldn't read the design thread of ${ticketId} (${errnoCode(cause)}); it starts empty.`);
      return empty;
    }
    try {
      const parsed = SavedThreadSchema.safeParse(JSON.parse(text));
      if (parsed.success && parsed.data.ticketId === ticketId) return parsed.data;
    } catch {
      // Not JSON; set aside below.
    }
    warn(`The design thread of ${ticketId} could not be read; it was set aside and starts empty.`);
    await fs.rename(file, join(options.dir, `${ticketId}.corrupt-${now()}.json`)).catch(() => undefined);
    return empty;
  }

  function save(entry: Entry): void {
    const data = `${JSON.stringify(entry.saved, null, 2)}\n`;
    const write = writes(entry.ticketId, () => writeFileAtomic(fs, fileFor(entry.ticketId), data)).catch((cause: unknown) =>
      warn(`Couldn't save the design thread of ${entry.ticketId}: ${cause instanceof Error ? cause.message : String(cause)}`),
    );
    pendingWrites.add(write);
    void write.finally(() => pendingWrites.delete(write));
  }

  function view(entry: Entry): DesignThread {
    return {
      ticketId: entry.ticketId,
      status: entry.status,
      reason: entry.reason,
      messages: entry.saved.messages,
      approval: entry.approval?.approval ?? null,
    };
  }

  function changed(entry: Entry): void {
    if (disposed) return;
    options.emit('design:thread', { ticketId: entry.ticketId, thread: view(entry) });
  }

  function append(entry: Entry, role: DesignThreadMessage['role'], text: string, error?: boolean): void {
    const message: DesignThreadMessage = { id: newId(), role, text: cut(text, DESIGN_THREAD_TEXT_MAX), at: now(), ...(error ? { error } : {}) };
    entry.saved = { ...entry.saved, messages: [...entry.saved.messages, message].slice(-DESIGN_THREAD_HISTORY_MAX) };
  }

  function settleApproval(entry: Entry, approve: boolean): void {
    const pending = entry.approval;
    entry.approval = null;
    pending?.settle(approve);
  }

  function stop(entry: Entry): void {
    const session = entry.session;
    if (!session) return;
    entry.session = null;
    settleApproval(entry, false);
    session.input.close();
    session.abort.abort();
    session.query?.close();
  }

  function canUseTool(entry: Entry, tool: string): CanUseTool {
    return async (toolName, input, { signal }): Promise<PermissionResult> => {
      if (toolName !== tool) return { behavior: 'deny', message: 'Only the design tool may be used in the design thread.' };
      if (tool === 'ClaudeDesign') {
        const operation = String(input['operation'] ?? '');
        if (CLAUDE_DESIGN_READ_OPERATIONS.has(operation)) return { behavior: 'allow', updatedInput: input };
        // A write carrying the token of a plan the user approved (D121); the server checks the token.
        if (operation !== 'finalize_plan' && hasPlanToken(input)) return { behavior: 'allow', updatedInput: input };
      } else if (ARTIFACT_READ_ACTIONS.has(String(input['action'] ?? 'publish'))) {
        return { behavior: 'allow', updatedInput: input };
      }
      if (entry.approval) return { behavior: 'deny', message: 'Another change is already waiting for the user. Wait for their answer.' };

      const { operation, summary } = summarize(tool, input);
      const approved = await new Promise<boolean>((resolve) => {
        entry.approval = { approval: { id: newId(), operation, summary, at: now() }, settle: resolve };
        signal.addEventListener('abort', () => settleApproval(entry, false), { once: true });
        changed(entry);
      });
      append(entry, 'notice', approved ? `You approved ${operation}.` : `You declined ${operation}.`);
      save(entry);
      changed(entry);
      return approved
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'The user declined this change. Ask what they would like instead.' };
    };
  }

  function start(entry: Entry, record: TicketRecord, canvas: DesignCanvasRef): Session {
    const tool = TOOL_BY_KIND[canvas.kind];
    // A relinked canvas starts a new session; the history stays.
    const resume = entry.saved.canvasUrl === canvas.url ? entry.saved.sessionId : null;
    const session: Session = { input: createInputQueue<SDKUserMessage>(), abort: new AbortController(), canvasUrl: canvas.url, query: undefined, started: false, resumed: resume !== null };
    entry.session = session;
    void (async () => {
      try {
        session.query = await options.claude.launch({
          // ClaudeDesign and Artifact need the claude.ai login; an API key can't reach them (D115).
          credential: { mode: 'login' },
          prompt: session.input,
          options: {
            model: options.model ?? DESIGN_THREAD_MODEL,
            tools: [tool],
            canUseTool: canUseTool(entry, tool),
            systemPrompt: threadPrompt(record, canvas),
            cwd: options.dir,
            settingSources: [],
            abortController: session.abort,
            ...(resume ? { resume } : {}),
          },
        });
      } catch (cause) {
        if (entry.session !== session) return;
        entry.session = null;
        entry.pendingTurns = 0;
        entry.status = 'unavailable';
        entry.reason = cut(cause instanceof Error ? cause.message : String(cause), 1_000);
        append(entry, 'notice', `The design session couldn't start: ${entry.reason}`, true);
        save(entry);
        changed(entry);
        return;
      }
      await pump(entry, session, tool);
    })();
    return session;
  }

  async function pump(entry: Entry, session: Session, tool: string): Promise<void> {
    const query = session.query!;
    let failure: string | null = null;
    try {
      for await (const message of query as AsyncIterable<SDKMessage>) {
        if (entry.session !== session) return;
        onMessage(entry, session, tool, message);
        if (entry.session !== session) return;
      }
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      query.close();
    }
    if (entry.session !== session) return;
    // The process ended on its own: the next message starts a new one.
    entry.session = null;
    settleApproval(entry, false);
    if (!session.started && session.resumed) entry.saved = { ...entry.saved, sessionId: null };
    if (entry.pendingTurns > 0) {
      append(entry, 'notice', `The design session stopped${failure ? ` (${cut(failure, 300)})` : ''}. Send your message again to carry on.`, true);
    }
    entry.pendingTurns = 0;
    if (entry.status === 'replying') entry.status = 'idle';
    save(entry);
    changed(entry);
  }

  function onMessage(entry: Entry, session: Session, tool: string, message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      if (!message.tools.includes(tool)) {
        stop(entry);
        entry.pendingTurns = 0;
        entry.status = 'unavailable';
        entry.reason = UNAVAILABLE_REASON;
        save(entry);
        changed(entry);
        return;
      }
      session.started = true;
      if (entry.saved.sessionId !== message.session_id || entry.saved.canvasUrl !== session.canvasUrl) {
        entry.saved = { ...entry.saved, sessionId: message.session_id, canvasUrl: session.canvasUrl };
        save(entry);
      }
      return;
    }
    if (message.type === 'assistant') {
      const text = message.message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
      if (!text) return;
      append(entry, 'design', text);
      save(entry);
      changed(entry);
      return;
    }
    if (message.type === 'result') {
      entry.pendingTurns = Math.max(0, entry.pendingTurns - 1);
      if (message.subtype !== 'success' || message.is_error) {
        const detail = message.subtype === 'success' ? message.result : message.subtype;
        append(entry, 'notice', `The design session couldn't answer (${cut(detail, 300)}).`, true);
      }
      if (entry.pendingTurns === 0) entry.status = 'idle';
      save(entry);
      changed(entry);
    }
  }

  return {
    async get(ticketId) {
      const entry = await load(ticketId);
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}`);
      const thread = view(entry);
      return ok(record.design.canvas === null && entry.status === 'idle' ? { ...thread, status: 'no-canvas' } : thread);
    },

    async send(ticketId, text) {
      if (disposed) return err('INTERNAL', 'Agent Lanes is closing.');
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}`);
      const canvas = record.design.canvas;
      if (!canvas) return err('VALIDATION', 'Link a Claude Design canvas to this ticket first.');
      const entry = await load(ticketId);

      append(entry, 'user', text);
      save(entry);
      if (entry.session && entry.session.canvasUrl !== canvas.url) stop(entry);
      // After an unavailable answer the user may have fixed the login: every send tries again.
      entry.status = 'replying';
      entry.reason = null;
      entry.pendingTurns += 1;
      const session = entry.session ?? start(entry, record, canvas);
      session.input.push(userMessage(text));
      changed(entry);
      return ok(view(entry));
    },

    async answer(ticketId, approvalId, approve) {
      const entry = await load(ticketId);
      if (entry.approval?.approval.id !== approvalId) return err('VALIDATION', 'That change is no longer waiting for an answer.');
      settleApproval(entry, approve);
      changed(entry);
      return ok(view(entry));
    },

    async dispose() {
      disposed = true;
      for (const pending of entries.values()) stop(await pending);
      // The history on disk is complete before the app quits.
      await Promise.all([...pendingWrites]);
    },
  };
}
