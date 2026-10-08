import type { AccountInfo, McpServerStatus, Options, SDKAssistantMessageError, SDKMessage, SDKResultMessage, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeQuery, ClaudeQueryFunction } from '../claude-sdk';

/**
 * A stand-in for the Agent SDK's `query()` (AL-044): no process starts and nothing leaves the
 * machine. Each call follows a script and is recorded, so tests can check the options and env a
 * `claude` process would have been given, what was sent to it, and that it was closed.
 *
 * Agent sessions (AL-100) use `live` scripts: the stream stays open like a running `claude` process,
 * the test pushes messages onto it and sees what the app sent, interrupted or changed.
 */

export interface FakeClaudeScript {
  /** What `accountInfo()` resolves to (or rejects with); never settles when `'hang'`. */
  account?: AccountInfo | Error | 'hang';
  /** What `getContextUsage()` reports (AL-113): tokens used of the window; rejects when an Error. */
  contextUsage?: { totalTokens: number; maxTokens: number; percentage: number } | Error;
  /** What `supportedCommands()` lists (AL-114); rejects when an Error, never settles when `'hang'`. */
  commands?: SlashCommand[] | Error | 'hang';
  /** Messages the stream yields, in order, after the prompt is read. */
  messages?: SDKMessage[];
  /** Thrown by the stream after `messages`, like a process that died. */
  failWith?: Error;
  /** The stream stays open after `messages` until the query is closed. */
  hang?: boolean;
  /** Written to the `stderr` option before anything else. */
  stderr?: string;
  /**
   * A live session (AL-100): after `messages` the stream stays open, yields what `call.push()` adds
   * and what `onSend` answers each sent user message with, and ends on `call.end()`, `call.fail()`
   * or close.
   */
  live?: boolean;
  /** What a live session answers each sent user message with (e.g. an assistant reply and a result). */
  onSend?: (message: SDKUserMessage, call: FakeClaudeCall) => SDKMessage[];
  /** What `mcpServerStatus()` answers (AL-108); change `call.mcpStatus` to change later answers. */
  mcpStatus?: McpServerStatus[];
}

export interface FakeClaudeCall {
  options: Options;
  /** The prompt when it was a string. */
  prompt: string | undefined;
  /** Messages an input stream (streaming-input mode) sent. */
  sent: SDKUserMessage[];
  closed: boolean;
  /** Live sessions: the stream yields these, as the `claude` process would. */
  push(...messages: SDKMessage[]): void;
  /** Live sessions: the stream ends normally, like a process that exited. */
  end(): void;
  /** Live sessions: the stream throws, like a process that died. */
  fail(error: Error): void;
  /** Resolves once the input stream has delivered `count` messages in all. */
  sentCount(count: number): Promise<void>;
  /** Calls to `interrupt()`. */
  interrupts: number;
  /** Arguments of each `setModel()` call. */
  models: Array<string | undefined>;
  /** Arguments of each `applyFlagSettings()` call. */
  flagSettings: Array<Record<string, unknown>>;
  /** What `mcpServerStatus()` answers now (AL-108). */
  mcpStatus: McpServerStatus[];
  /** Server names passed to `reconnectMcpServer()`. */
  reconnects: string[];
  /**
   * Everything the app did to the session, in the order it happened (AL-221): each user message the
   * input stream delivered (with its text and priority) and each control call. Lets a test check
   * that a model change came before the next message, or an interrupt before a `now` message.
   */
  log: FakeClaudeEntry[];
  /** The sent user messages as text, priority and `shouldQuery`, which is what most tests compare. */
  inputs(): FakeClaudeInput[];
}

export interface FakeClaudeInput {
  /** The message content when it was a string; text blocks joined with newlines otherwise. */
  text: string;
  /** The SDK's queue priority: `now` interrupts, `next` waits for the turn to end; undefined when unset. */
  priority: SDKUserMessage['priority'];
  /** False for context the app adds without starting a turn (e.g. a build result). */
  shouldQuery: boolean | undefined;
}

export type FakeClaudeEntry =
  | ({ kind: 'input' } & FakeClaudeInput)
  | { kind: 'interrupt' }
  | { kind: 'setModel'; model: string | undefined }
  | { kind: 'applyFlagSettings'; settings: Record<string, unknown> }
  | { kind: 'close' };

function inputOf(message: SDKUserMessage): FakeClaudeInput {
  const content = message.message.content;
  const text =
    typeof content === 'string'
      ? content
      : content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .filter(Boolean)
          .join('\n');
  return { text, priority: message.priority, shouldQuery: message.shouldQuery };
}

export interface FakeClaude {
  query: ClaudeQueryFunction;
  calls: FakeClaudeCall[];
}

export function createFakeClaude(script: FakeClaudeScript | ((call: FakeClaudeCall) => FakeClaudeScript)): FakeClaude {
  const calls: FakeClaudeCall[] = [];

  const query: ClaudeQueryFunction = ({ prompt, options = {} }) => {
    const pending: SDKMessage[] = [];
    let ended = false;
    let failure: Error | undefined;
    let wakeStream: (() => void) | undefined;
    const wake = () => {
      const resolve = wakeStream;
      wakeStream = undefined;
      resolve?.();
    };
    const sentWaiters: Array<{ count: number; resolve: () => void }> = [];

    const call: FakeClaudeCall = {
      options,
      prompt: typeof prompt === 'string' ? prompt : undefined,
      sent: [],
      closed: false,
      push(...messages) {
        pending.push(...messages);
        wake();
      },
      end() {
        ended = true;
        wake();
      },
      fail(error) {
        failure = error;
        wake();
      },
      sentCount(count) {
        return call.sent.length >= count ? Promise.resolve() : new Promise((resolve) => sentWaiters.push({ count, resolve }));
      },
      interrupts: 0,
      models: [],
      flagSettings: [],
      mcpStatus: [],
      reconnects: [],
      log: [],
      inputs: () => call.sent.map(inputOf),
    };
    calls.push(call);
    const plan = typeof script === 'function' ? script(call) : script;
    if (plan.mcpStatus) call.mcpStatus = plan.mcpStatus;
    let wakeClosed: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      wakeClosed = resolve;
    });

    if (plan.stderr) options.stderr?.(plan.stderr);
    if (typeof prompt !== 'string') {
      void (async () => {
        for await (const message of prompt) {
          call.sent.push(message);
          call.log.push({ kind: 'input', ...inputOf(message) });
          for (const waiter of sentWaiters.filter((w) => call.sent.length >= w.count)) {
            sentWaiters.splice(sentWaiters.indexOf(waiter), 1);
            waiter.resolve();
          }
          if (plan.live && plan.onSend) call.push(...plan.onSend(message, call));
        }
      })();
    }
    const account: Promise<AccountInfo> =
      plan.account === 'hang'
        ? new Promise<AccountInfo>(() => undefined)
        : plan.account instanceof Error
          ? Promise.reject(plan.account)
          : Promise.resolve(plan.account ?? {});
    account.catch(() => undefined);

    async function* stream(): AsyncGenerator<SDKMessage, void> {
      for (const message of plan.messages ?? []) {
        if (call.closed) return;
        yield message;
      }
      if (plan.failWith) throw plan.failWith;
      if (plan.live) {
        for (;;) {
          if (call.closed) return;
          const next = pending.shift();
          if (next) {
            yield next;
            continue;
          }
          if (failure) throw failure;
          if (ended) return;
          await new Promise<void>((resolve) => (wakeStream = resolve));
        }
      }
      if (plan.hang) await closed;
    }

    const fake: ClaudeQuery = Object.assign(stream(), {
      accountInfo: () => account,
      close: () => {
        if (!call.closed) call.log.push({ kind: 'close' });
        call.closed = true;
        wakeClosed?.();
        wake();
      },
      interrupt: async () => {
        call.interrupts += 1;
        call.log.push({ kind: 'interrupt' });
        return undefined;
      },
      setModel: async (model?: string) => {
        call.models.push(model);
        call.log.push({ kind: 'setModel', model });
      },
      applyFlagSettings: async (settings: Record<string, unknown>) => {
        call.flagSettings.push(settings);
        call.log.push({ kind: 'applyFlagSettings', settings });
      },
      supportedCommands: () => {
        const commands = plan.commands ?? [];
        if (commands === 'hang') return new Promise<SlashCommand[]>(() => undefined);
        return commands instanceof Error ? Promise.reject(commands) : Promise.resolve(commands);
      },
      getContextUsage: async () => {
        const usage = plan.contextUsage ?? { totalTokens: 0, maxTokens: 200_000, percentage: 0 };
        if (usage instanceof Error) throw usage;
        return { categories: [], gridRows: [], model: 'fake', memoryFiles: [], rawMaxTokens: usage.maxTokens, ...usage } as unknown as Awaited<
          ReturnType<ClaudeQuery['getContextUsage']>
        >;
      },
      mcpServerStatus: async () => call.mcpStatus.map((server) => ({ ...server })),
      reconnectMcpServer: async (serverName: string) => {
        call.reconnects.push(serverName);
      },
    });
    options.abortController?.signal.addEventListener('abort', () => fake.close(), { once: true });
    return fake;
  };

  return { query, calls };
}

const ids = { uuid: '00000000-0000-4000-8000-000000000000', session_id: 'fake-session' } as const;

/** An assistant reply, optionally marked with the SDK's API error kind (e.g. `authentication_failed`). */
export function fakeAssistant(text: string, error?: SDKAssistantMessageError): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    ...(error ? { error } : {}),
    ...ids,
  } as unknown as SDKMessage;
}

/** A turn's result: `is_error` with the text Claude Code shows for a failed request, or a plain success. */
export function fakeResult(fields: { result?: string; is_error?: boolean; api_error_status?: number } = {}): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'OK',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    ...fields,
    ...ids,
  } as unknown as SDKResultMessage;
}

/** A result that ended without a successful turn (`error_during_execution`, `error_max_turns`, …). */
export function fakeErrorResult(subtype: string, fields: { errors?: string[]; startup_failure_reason?: string } = {}): SDKResultMessage {
  return { ...fakeResult(), subtype, is_error: true, errors: fields.errors ?? [], ...fields } as unknown as SDKResultMessage;
}

/** The `system/init` message a session starts with; `session_id` is what `resume` takes (AL-100, AL-110). */
export function fakeInit(sessionId: string, fields: { cwd?: string; model?: string } = {}): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    claude_code_version: '0.0.0-fake',
    cwd: fields.cwd ?? '',
    tools: [],
    mcp_servers: [],
    model: fields.model ?? 'claude-opus-5-5',
    permissionMode: 'acceptEdits',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: ids.uuid,
    session_id: sessionId,
  } as unknown as SDKMessage;
}

/** One finished turn as a live session streams it: the assistant's reply, then a successful result. */
export function fakeTurn(text: string): SDKMessage[] {
  return [fakeAssistant(text), fakeResult({ result: text })];
}
