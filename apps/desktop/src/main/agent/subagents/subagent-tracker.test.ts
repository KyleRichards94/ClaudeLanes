import type { HookCallback, HookInput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { subagentCountsLabel, type AgentSubagentEvent } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import type { SessionMessageListener } from '../session-manager';
import { recordingEmit } from '../testing/sessions';
import { createSubagentTracker, modelOf, statusOf } from './subagent-tracker';

function fakeSessions() {
  let listener: SessionMessageListener | undefined;
  return {
    subscribe: (next: SessionMessageListener) => {
      listener = next;
      return () => (listener = undefined);
    },
    deliver(ticketId: string, message: Record<string, unknown>) {
      listener?.({ ticketId, cwd: 'C:/repo', resumed: false, message: { uuid: 'u', session_id: 's', ...message } as unknown as SDKMessage });
    },
    get listening() {
      return listener !== undefined;
    },
  };
}

function setup() {
  const sessions = fakeSessions();
  const recorder = recordingEmit();
  let clock = 1_000;
  const tracker = createSubagentTracker({ sessions, emit: recorder.emit, now: () => (clock += 10) });
  const events = () => recorder.of('agent:subagent') as unknown as AgentSubagentEvent[];
  return { sessions, tracker, events };
}

/** The lead agent (or a sub-agent, with `parent`) asking for a sub-agent through the Agent tool. */
function agentToolUse(id: string, input: Record<string, unknown>, parent: string | null = null): Record<string, unknown> {
  return { type: 'assistant', parent_tool_use_id: parent, message: { id: `msg-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input }] } };
}

function toolResult(toolUseId: string, text: string, isError = false): Record<string, unknown> {
  return { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: [{ type: 'text', text }] }] } };
}

function system(subtype: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype, ...fields };
}

async function runHook(hook: HookCallback | undefined, input: Record<string, unknown>): Promise<void> {
  await hook?.({ session_id: 's', transcript_path: 't', cwd: 'C:/repo', ...input } as unknown as HookInput, undefined, { signal: new AbortController().signal });
}

describe('sub-agent tracker (AL-107)', () => {
  it("panel counts follow the SDK's task states: 2 running · 1 done · 1 queued", () => {
    const { sessions, tracker, events } = setup();

    sessions.deliver('71273', agentToolUse('tu-explore', { subagent_type: 'explore', description: 'Map child modals' }));
    sessions.deliver('71273', agentToolUse('tu-grid', { subagent_type: 'razor-writer', description: 'Build JobGrid.razor', model: 'sonnet' }));
    sessions.deliver('71273', agentToolUse('tu-css', { subagent_type: 'css-writer', description: 'Port styles' }));
    sessions.deliver('71273', agentToolUse('tu-review', { subagent_type: 'reviewer', description: 'Review the diff' }));
    expect(tracker.counts('71273')).toEqual({ queued: 4, running: 0, done: 0, failed: 0 });

    sessions.deliver('71273', system('task_started', { task_id: 't1', tool_use_id: 'tu-explore', description: 'Map child modals', task_type: 'local_agent' }));
    sessions.deliver('71273', system('task_started', { task_id: 't2', tool_use_id: 'tu-grid', description: 'Build JobGrid.razor', task_type: 'local_agent' }));
    sessions.deliver('71273', system('task_started', { task_id: 't3', tool_use_id: 'tu-css', description: 'Port styles', task_type: 'local_agent' }));
    sessions.deliver('71273', system('task_progress', { task_id: 't1', tool_use_id: 'tu-explore', description: 'Map child modals', summary: 'Mapped 4 child modals', usage: { total_tokens: 18_000, tool_uses: 3, duration_ms: 900 } }));
    sessions.deliver('71273', system('task_notification', { task_id: 't1', tool_use_id: 'tu-explore', status: 'completed', output_file: 'o', summary: 'Found 4 child modals', usage: { total_tokens: 21_000, tool_uses: 5, duration_ms: 1_200 } }));

    const { counts, nodes } = tracker.get('71273');
    expect(counts).toEqual({ queued: 1, running: 2, done: 1, failed: 0 });
    expect(subagentCountsLabel(counts)).toBe('2 running · 1 done · 1 queued');
    expect(nodes.map((node) => [node.name, node.status])).toEqual([
      ['explore', 'done'],
      ['razor-writer', 'running'],
      ['css-writer', 'running'],
      ['reviewer', 'queued'],
    ]);
    expect(nodes[0]).toMatchObject({ activity: 'Found 4 child modals', tokens: 21_000, readOnly: true, taskId: 't1' });
    expect(nodes[1]).toMatchObject({ model: 'sonnet', readOnly: false, description: 'Build JobGrid.razor' });
    // Every event carries the counts as they were after its change.
    expect(events().at(-1)?.counts).toEqual(counts);
    expect(events().at(-1)?.change).toBe('finished');
  });

  it('nests a sub-agent under the one whose output carried its tool use', () => {
    const { sessions, tracker } = setup();
    sessions.deliver('71273', agentToolUse('tu-lead', { subagent_type: 'planner', description: 'Plan' }));
    sessions.deliver('71273', agentToolUse('tu-child', { subagent_type: 'explore', description: 'Look around' }, 'tu-lead'));
    expect(tracker.get('71273').nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['tu-lead', null],
      ['tu-child', 'tu-lead'],
    ]);
  });

  it('a failed or killed task is Failed; a late progress frame does not bring it back', () => {
    const { sessions, tracker } = setup();
    sessions.deliver('71273', agentToolUse('tu-a', { subagent_type: 'razor-writer', description: 'Write' }));
    sessions.deliver('71273', system('task_started', { task_id: 't1', tool_use_id: 'tu-a', description: 'Write', task_type: 'local_agent' }));
    sessions.deliver('71273', system('task_updated', { task_id: 't1', patch: { status: 'killed', error: 'Stopped by the user' } }));
    sessions.deliver('71273', system('task_progress', { task_id: 't1', tool_use_id: 'tu-a', description: 'Write', usage: { total_tokens: 5, tool_uses: 0, duration_ms: 1 } }));
    expect(tracker.get('71273').nodes[0]).toMatchObject({ status: 'failed', activity: 'Stopped by the user' });
  });

  it("a foreground sub-agent finishes from the Agent tool's result; a backgrounded one waits for its task", () => {
    const { sessions, tracker } = setup();
    sessions.deliver('71273', agentToolUse('tu-fg', { subagent_type: 'explore', description: 'Look' }));
    sessions.deliver('71273', agentToolUse('tu-bg', { subagent_type: 'razor-writer', description: 'Write' }));
    sessions.deliver('71273', toolResult('tu-fg', 'Found the grid\nmore lines'));
    sessions.deliver('71273', toolResult('tu-bg', 'Async agent launched successfully'));
    sessions.deliver('71273', toolResult('tu-other', 'not a sub-agent'));
    expect(tracker.get('71273').nodes.map((node) => [node.id, node.status, node.activity])).toEqual([
      ['tu-fg', 'done', 'Found the grid'],
      ['tu-bg', 'queued', null],
    ]);
  });

  it('ignores shell and other non-agent tasks', () => {
    const { sessions, tracker, events } = setup();
    sessions.deliver('71273', system('task_started', { task_id: 'sh', description: 'pnpm test', task_type: 'local_bash' }));
    expect(tracker.get('71273').nodes).toEqual([]);
    expect(events()).toEqual([]);
  });

  it('the SubagentStart / SubagentStop hooks move a sub-agent to Running and Done with its effort', async () => {
    const { sessions, tracker } = setup();
    sessions.deliver('71273', agentToolUse('tu-a', { subagent_type: 'razor-writer', description: 'Write' }));
    const hooks = tracker.hooks('71273');

    await runHook(hooks.SubagentStart?.[0]?.hooks[0], { hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'razor-writer' });
    expect(tracker.get('71273').nodes[0]).toMatchObject({ status: 'running', taskId: 'agent-1' });

    await runHook(hooks.SubagentStop?.[0]?.hooks[0], {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-1',
      agent_type: 'razor-writer',
      agent_transcript_path: 'a',
      stop_hook_active: false,
      last_assistant_message: 'Column templates done',
      effort: { level: 'high' },
    });
    expect(tracker.get('71273').nodes[0]).toMatchObject({ status: 'done', effort: 'high', activity: 'Column templates done' });
  });

  it('links a writer to its sub-branch, and branch status sees it running until it finishes', () => {
    const { sessions, tracker } = setup();
    sessions.deliver('71273', agentToolUse('tu-explore', { subagent_type: 'explore', description: 'Look' }));
    sessions.deliver('71273', agentToolUse('tu-grid', { subagent_type: 'razor-writer', description: 'Write' }));
    sessions.deliver('71273', system('task_started', { task_id: 't2', tool_use_id: 'tu-grid', description: 'Write', task_type: 'local_agent' }));

    tracker.noteSubBranch('71273', { name: 'grid', branch: 'sub/71273-grid', agentType: 'razor-writer' });

    const nodes = tracker.get('71273').nodes;
    expect(nodes.find((node) => node.id === 'tu-grid')?.branch).toBe('sub/71273-grid');
    expect(nodes.find((node) => node.id === 'tu-explore')?.branch).toBeNull();
    expect(tracker.isRunning('71273', 'grid')).toBe(true);
    expect(tracker.isRunning('71273', 'unknown')).toBe(false);

    sessions.deliver('71273', system('task_notification', { task_id: 't2', status: 'completed', output_file: 'o', summary: 'Done' }));
    expect(tracker.isRunning('71273', 'grid')).toBe(false);
  });

  it("keeps tickets apart, adds the lead agent's tokens, and stops listening on dispose", () => {
    const { sessions, tracker } = setup();
    sessions.deliver('71273', agentToolUse('tu-a', { subagent_type: 'explore', description: 'Look' }));
    sessions.deliver('71273', { type: 'result', subtype: 'success', usage: { input_tokens: 1_000, output_tokens: 200 } });
    expect(tracker.get('71288')).toEqual({ ticketId: '71288', leadTokens: 0, nodes: [], counts: { queued: 0, running: 0, done: 0, failed: 0 } });
    expect(tracker.get('71273').leadTokens).toBe(1_200);

    tracker.dispose();
    expect(sessions.listening).toBe(false);
  });

  it('maps model names and SDK task states', () => {
    expect([modelOf('sonnet'), modelOf('claude-opus-4-7'), modelOf('inherit'), modelOf(undefined)]).toEqual(['sonnet', 'opus', null, null]);
    expect(['pending', 'running', 'paused', 'completed', 'failed', 'killed', 'stopped', 'weird'].map(statusOf)).toEqual([
      'queued',
      'running',
      'running',
      'done',
      'failed',
      'failed',
      'failed',
      null,
    ]);
  });
});
