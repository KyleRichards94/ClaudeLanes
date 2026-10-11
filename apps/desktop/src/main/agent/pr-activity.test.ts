import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { createPrActivityTracker, prActivityKind } from './pr-activity';
import type { SessionMessageListener } from './session-manager';
import { memoryTickets, recordingEmit } from './testing/sessions';

function toolUse(id: string, name: string): SDKMessage {
  return { type: 'assistant', message: { id: 'msg', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'tool_use', id, name, input: {} }], stop_reason: null, stop_sequence: null, usage: {} }, parent_tool_use_id: null, uuid: `u-${id}`, session_id: 's' } as unknown as SDKMessage;
}

function toolResult(id: string, isError = false): SDKMessage {
  return { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...(isError ? { is_error: true } : {}) }] }, parent_tool_use_id: null, uuid: `r-${id}`, session_id: 's' } as unknown as SDKMessage;
}

describe('PR activity tracking (AL-269)', () => {
  it('knows which ADO tools post comments or settle threads', () => {
    expect(prActivityKind('mcp__azure-devops__add_pull_request_comment')).toBe('comment');
    expect(prActivityKind('mcp__ado__reply_to_pull_request_comment')).toBe('comment');
    expect(prActivityKind('mcp__ado__update_pull_request_thread_status')).toBe('thread');
    expect(prActivityKind('mcp__ado__get_pull_request_comments')).toBeNull();
    expect(prActivityKind('mcp__ado__create_work_item_comment')).toBeNull();
    expect(prActivityKind('Bash')).toBeNull();
  });

  it('counts each successful call on the ticket record and pushes agent:prActivity; failed calls do not count', async () => {
    const tickets = await memoryTickets({ id: 'pr-11635-review' });
    const events = recordingEmit();
    let listener: SessionMessageListener | undefined;
    const tracker = createPrActivityTracker({
      sessions: { subscribe: (fn) => ((listener = fn), () => undefined) },
      tickets,
      emit: events.emit,
      now: () => 7_000,
    });
    const deliver = (message: SDKMessage) => listener!({ ticketId: 'pr-11635-review', cwd: 'C:\\wt', resumed: false, message });

    deliver(toolUse('t1', 'mcp__azure-devops__add_pull_request_comment'));
    deliver(toolUse('t2', 'mcp__azure-devops__add_pull_request_comment'));
    deliver(toolUse('t3', 'mcp__azure-devops__update_pull_request_thread_status'));
    deliver(toolUse('t4', 'mcp__azure-devops__get_pull_request'));
    deliver(toolResult('t1'));
    deliver(toolResult('t2', true));
    deliver(toolResult('t3'));
    deliver(toolResult('t4'));

    await expect(tracker.get('pr-11635-review')).resolves.toEqual({ comments: 1, threads: 1, updatedAt: 7_000 });
    expect(events.of('agent:prActivity', 'pr-11635-review').map((event) => event['activity'])).toEqual([
      { comments: 1, threads: 0, updatedAt: 7_000 },
      { comments: 1, threads: 1, updatedAt: 7_000 },
    ]);
    tracker.dispose();
  });
});
