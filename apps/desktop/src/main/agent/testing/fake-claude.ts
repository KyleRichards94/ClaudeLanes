import type { AccountInfo, Options, SDKAssistantMessageError, SDKMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeQuery, ClaudeQueryFunction } from '../claude-sdk';

/**
 * A stand-in for the Agent SDK's `query()` (AL-044): no process starts and nothing leaves the
 * machine. Each call follows a script and is recorded, so tests can check the options and env a
 * `claude` process would have been given, what was sent to it, and that it was closed.
 */

export interface FakeClaudeScript {
  /** What `accountInfo()` resolves to (or rejects with); never settles when `'hang'`. */
  account?: AccountInfo | Error | 'hang';
  /** Messages the stream yields, in order, after the prompt is read. */
  messages?: SDKMessage[];
  /** Thrown by the stream after `messages`, like a process that died. */
  failWith?: Error;
  /** The stream stays open after `messages` until the query is closed. */
  hang?: boolean;
  /** Written to the `stderr` option before anything else. */
  stderr?: string;
}

export interface FakeClaudeCall {
  options: Options;
  /** The prompt when it was a string. */
  prompt: string | undefined;
  /** Messages an input stream (streaming-input mode) sent. */
  sent: SDKUserMessage[];
  closed: boolean;
}

export interface FakeClaude {
  query: ClaudeQueryFunction;
  calls: FakeClaudeCall[];
}

export function createFakeClaude(script: FakeClaudeScript | ((call: FakeClaudeCall) => FakeClaudeScript)): FakeClaude {
  const calls: FakeClaudeCall[] = [];

  const query: ClaudeQueryFunction = ({ prompt, options = {} }) => {
    const call: FakeClaudeCall = { options, prompt: typeof prompt === 'string' ? prompt : undefined, sent: [], closed: false };
    calls.push(call);
    const plan = typeof script === 'function' ? script(call) : script;
    let wake: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      wake = resolve;
    });

    if (plan.stderr) options.stderr?.(plan.stderr);
    if (typeof prompt !== 'string') {
      void (async () => {
        for await (const message of prompt) call.sent.push(message);
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
      if (plan.hang) await closed;
    }

    const fake: ClaudeQuery = Object.assign(stream(), {
      accountInfo: () => account,
      close: () => {
        call.closed = true;
        wake?.();
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
