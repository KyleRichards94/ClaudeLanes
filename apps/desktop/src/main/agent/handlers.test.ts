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
    }),
    stages,
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
        lastSeq: 2,
        events: [
          { ticketId: '71273', at: 1_000, seq: 1, item: { kind: 'text', text: 'Reading the form first.' } },
          { ticketId: '71273', at: 1_000, seq: 2, item: { kind: 'result', isError: false } },
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
