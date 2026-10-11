import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Services } from '../services';
import { describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import type { TicketRecordStore } from '../tickets';
import { createClaudeLauncher } from './claude-sdk';
import { createAgentHandlers } from './handlers';
import { createUsageService } from './usage/usage-service';
import { createMcpStatusMonitor } from './mcp';
import { createLaunchQueue } from './launch-queue';
import { createSessionRecovery } from './recovery';
import { testPermissions } from './testing/sessions';
import { createTranscriptService } from './output/transcript';
import { createSessionManager, type SessionManager } from './session-manager';
import { createStageService } from './stages/stage-service';
import { createSubagentTracker } from './subagents/subagent-tracker';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

function handlersFor(sessions: SessionManager, tickets: TicketRecordStore, now = () => 1_000) {
  const emit = recordingEmit();
  const transcripts = createTranscriptService({ sessions, tickets, emit: emit.emit, now });
  const stages = createStageService({ tickets, emit: emit.emit, transcripts, userName: () => 'Kyle', now });
  const subagents = createSubagentTracker({ sessions, emit: emit.emit });
  return {
    handlers: createAgentHandlers({
      sessions,
      transcripts,
      stages,
      mcpStatus: createMcpStatusMonitor({ sessions, emit: recordingEmit().emit, intervalMs: 0 }),
      permissions: testPermissions(),
      subagents,
      usage: createUsageService({ sessions, emit: recordingEmit().emit }),
      recovery: createSessionRecovery({ sessions, emit: recordingEmit().emit }),
      launches: createLaunchQueue({ sessions, tickets, maxAgents: () => 3, emit: recordingEmit().emit }),
      // Launch from the team board (AL-236) has its own tests.
      adoLauncher: {} as Services['adoLauncher'],
      launchUndo: {} as Services['launchUndo'],
    tickets,
    // Next actions (AL-272) have their own tests.
    nextActions: {} as Services['nextActions'],
    // Plan limits (AL-258) have their own tests.
    planLimits: { get: () => ({ available: false, fiveHour: null, sevenDay: null, status: 'allowed' as const, limitedWindow: null, waitingTickets: [], updatedAt: null }), holdReason: () => null, dispose: () => undefined },
    }),
    stages,
    subagents,
    emit,
  };
}

function idleSessions(tickets: TicketRecordStore): SessionManager {
  return createSessionManager({ claude: createClaudeLauncher({ executable: () => null }), connections: fakeClaudeConnections(), tickets, emit: recordingEmit().emit });
}

describe('agent IPC handlers', () => {
  it("agent:getStatus returns the ticket's session status, never its credential", async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
    const tickets = await memoryTickets({ id: '71273' });
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections('api-key', 'sk-ant-test-3333-not-a-real-key-3333-Qw78'), tickets, emit: recordingEmit().emit });
    const { handlers } = handlersFor(sessions, tickets);

    await expect(handleInvoke('agent:getStatus', { ticketId: '71273' }, handlers['agent:getStatus'])).resolves.toEqual({
      ok: true,
      data: { ticketId: '71273', state: 'none', sessionId: null, message: null },
    });

    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => sessions.status('71273').sessionId === 'session-a');
    const result = await handleInvoke('agent:getStatus', { ticketId: '71273' }, handlers['agent:getStatus']);
    expect(result).toEqual({ ok: true, data: { ticketId: '71273', state: 'running', sessionId: 'session-a', message: null } });
    expect(JSON.stringify(result)).not.toContain('sk-ant');
    await sessions.dispose();
  });

  it('agent:getStatus refuses a request that is not a ticket id', async () => {
    const tickets = await memoryTickets();
    const { handlers } = handlersFor(idleSessions(tickets), tickets);
    await expect(handleInvoke('agent:getStatus', { ticketId: '../etc' }, handlers['agent:getStatus'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(handleInvoke('agent:getStatus', undefined, handlers['agent:getStatus'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it("agent:getSubagents returns the ticket's sub-agent tree and counts (AL-107)", async () => {
    const tickets = await memoryTickets({ id: '71273' });
    const { handlers } = handlersFor(idleSessions(tickets), tickets);
    await expect(handleInvoke('agent:getSubagents', { ticketId: '71273' }, handlers['agent:getSubagents'])).resolves.toEqual({
      ok: true,
      data: { ticketId: '71273', leadTokens: 0, nodes: [], counts: { queued: 0, running: 0, done: 0, failed: 0 } },
    });
  });

  it('agent:getTranscript returns the ticket output buffered in main', async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a'), fakeAssistant('Reading the form first.'), fakeResult()] });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
    const tickets = await memoryTickets({ id: '71273' });
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections(), tickets, emit: recordingEmit().emit });
    const { handlers } = handlersFor(sessions, tickets);

    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => sessions.status('71273').state === 'idle');
    const result = await handleInvoke('agent:getTranscript', { ticketId: '71273' }, handlers['agent:getTranscript']);
    expect(result).toMatchObject({
      ok: true,
      data: {
        ticketId: '71273',
        lastSeq: 3,
        events: [
          // The launch's job shows as the user's first message (AL-251).
          { ticketId: '71273', at: 1_000, seq: 1, item: { kind: 'user', text: 'Cut it over', source: 'launch' } },
          { ticketId: '71273', at: 1_000, seq: 2, item: { kind: 'text', text: 'Reading the form first.' } },
          { ticketId: '71273', at: 1_000, seq: 3, item: { kind: 'result', isError: false } },
        ],
      },
    });
    await sessions.dispose();
  });
});

describe('agent gate IPC handlers (AL-104)', () => {
  async function waitingGate() {
    const tickets = await memoryTickets({ id: '71273', stage: 'planning' });
    const setup = handlersFor(idleSessions(tickets), tickets);
    const moving = setup.stages.setStage('71273', 'implementing', 'Plan ready');
    await eventually(() => setup.stages.pendingGate('71273') !== null);
    return { ...setup, tickets, moving };
  }

  it('agent:getGate shows the waiting gate, and agent:resolveGate approves it', async () => {
    const { handlers, tickets, moving } = await waitingGate();

    await expect(handleInvoke('agent:getGate', { ticketId: '71273' }, handlers['agent:getGate'])).resolves.toEqual({
      ok: true,
      data: { gate: { stage: 'planning', from: 'planning', to: 'implementing', summary: 'Plan ready', openedAt: 1_000 } },
    });
    await expect(handleInvoke('agent:resolveGate', { ticketId: '71273', decision: 'approve' }, handlers['agent:resolveGate'])).resolves.toEqual({ ok: true, data: { resolved: true } });
    await expect(moving).resolves.toMatchObject({ ok: true, data: { changed: true, gate: { outcome: 'approved', by: 'Kyle' } } });
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    await expect(handleInvoke('agent:resolveGate', { ticketId: '71273', decision: 'approve' }, handlers['agent:resolveGate'])).resolves.toEqual({ ok: true, data: { resolved: false } });
    await expect(handleInvoke('agent:getGate', { ticketId: '71273' }, handlers['agent:getGate'])).resolves.toEqual({ ok: true, data: { gate: null } });
  });

  it('agent:resolveGate needs a note to request changes', async () => {
    const { handlers, moving } = await waitingGate();
    await expect(handleInvoke('agent:resolveGate', { ticketId: '71273', decision: 'request-changes', note: '  ' }, handlers['agent:resolveGate'])).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    await expect(
      handleInvoke('agent:resolveGate', { ticketId: '71273', decision: 'request-changes', note: 'Keep frmJobNotes in WinForms' }, handlers['agent:resolveGate']),
    ).resolves.toEqual({ ok: true, data: { resolved: true } });
    await expect(moving).resolves.toMatchObject({ ok: true, data: { changed: false, gate: { outcome: 'changes-requested', note: 'Keep frmJobNotes in WinForms' } } });
  });

  it('agent:setGate saves the gate on the ticket, and switching off the waiting gate releases it as approved', async () => {
    const { handlers, tickets, moving } = await waitingGate();
    const result = await handleInvoke('agent:setGate', { ticketId: '71273', stage: 'planning', gate: 'auto' }, handlers['agent:setGate']);
    expect(result).toMatchObject({ ok: true, data: { released: true, gates: { planning: 'auto', 'create-pr': 'approval' } } });
    await expect(moving).resolves.toMatchObject({ ok: true, data: { changed: true, gate: { outcome: 'approved', by: null } } });
    expect((await tickets.get('71273'))?.gates.planning).toBe('auto');
    await expect(handleInvoke('agent:setGate', { ticketId: '71273', stage: 'done', gate: 'auto' }, handlers['agent:setGate'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});

describe('agent:stopSubagent (AL-261)', () => {
  const system = (fields: Record<string, unknown>) => ({ type: 'system', uuid: `u_${String(fields['task_id'])}_${String(fields['subtype'])}`, session_id: 'session-a', ...fields }) as unknown as SDKMessage;

  it("stops a running sub-agent's task, says so when it already finished, and refuses an unknown one", async () => {
    const fake = createFakeClaude({
      live: true,
      messages: [
        fakeInit('session-a'),
        system({ subtype: 'task_started', task_id: 'task_1', tool_use_id: 'toolu_a', description: 'Map the forms', task_type: 'local_agent', subagent_type: 'explore' }),
        system({ subtype: 'task_started', task_id: 'task_2', tool_use_id: 'toolu_b', description: 'Write the grid', task_type: 'local_agent', subagent_type: 'writer' }),
        system({ subtype: 'task_notification', task_id: 'task_2', tool_use_id: 'toolu_b', status: 'completed', summary: 'Wrote JobGrid.razor', usage: { total_tokens: 800 } }),
      ],
    });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
    const tickets = await memoryTickets({ id: '71273' });
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections(), tickets, emit: recordingEmit().emit });
    const { handlers, subagents } = handlersFor(sessions, tickets);
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => subagents.get('71273').nodes.length === 2 && subagents.get('71273').nodes[1]?.status === 'done');

    await expect(handleInvoke('agent:stopSubagent', { ticketId: '71273', nodeId: 'toolu_a' }, handlers['agent:stopSubagent'])).resolves.toEqual({ ok: true, data: { stopped: true } });
    expect(fake.calls[0]!.stoppedTasks).toEqual(['task_1']);
    await expect(handleInvoke('agent:stopSubagent', { ticketId: '71273', nodeId: 'toolu_b' }, handlers['agent:stopSubagent'])).resolves.toEqual({ ok: true, data: { stopped: false } });
    await expect(handleInvoke('agent:stopSubagent', { ticketId: '71273', nodeId: 'nope' }, handlers['agent:stopSubagent'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(fake.calls[0]!.stoppedTasks).toEqual(['task_1']);
    await sessions.dispose();
  });
});

describe('agent:send without a live session (AL-268)', () => {
  it('starts an agent with the message as its job when the ticket never ran, and resumes an ended session', async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
    const tickets = await memoryTickets({ id: '71273' });
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections(), tickets, emit: recordingEmit().emit });
    const { handlers } = handlersFor(sessions, tickets);

    await expect(handleInvoke('agent:send', { ticketId: '71273', text: 'What is the status?' }, handlers['agent:send'])).resolves.toEqual({ ok: true, data: { held: false } });
    const first = fake.calls[0]!;
    await first.sentCount(1);
    expect(JSON.stringify(first.sent[0])).toContain('What is the status?');
    await eventually(() => sessions.status('71273').sessionId === 'session-a');

    // The session ended: the next message resumes it instead of being refused.
    await sessions.stop('71273');
    expect(sessions.status('71273').state).toBe('stopped');
    await expect(handleInvoke('agent:send', { ticketId: '71273', text: 'Still there?' }, handlers['agent:send'])).resolves.toEqual({ ok: true, data: { held: false } });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.options.resume).toBe('session-a');
    await fake.calls[1]!.sentCount(1);
    expect(JSON.stringify(fake.calls[1]!.sent[0])).toContain('Still there?');
    await sessions.dispose();
  });
});

describe('agent:moveStage (AL-270)', () => {
  it('moves the ticket and tells a live agent as an app note; a ticket with no session just moves', async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
    const tickets = await memoryTickets({ id: '71273' });
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections(), tickets, emit: recordingEmit().emit });
    const { handlers } = handlersFor(sessions, tickets);

    await expect(handleInvoke('agent:moveStage', { ticketId: '71273', stage: 'qa' }, handlers['agent:moveStage'])).resolves.toMatchObject({ ok: true, data: { to: 'qa', changed: true } });
    expect(fake.calls).toHaveLength(0);

    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    await expect(handleInvoke('agent:moveStage', { ticketId: '71273', stage: 'code-review' }, handlers['agent:moveStage'])).resolves.toMatchObject({ ok: true, data: { from: 'qa', to: 'code-review', changed: true } });
    await fake.calls[0]!.sentCount(2);
    expect(JSON.stringify(fake.calls[0]!.sent[1])).toContain('moved this ticket to Code review');
    await expect(handleInvoke('agent:moveStage', { ticketId: '71273', stage: 'queued' }, handlers['agent:moveStage'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await sessions.dispose();
  });
});
