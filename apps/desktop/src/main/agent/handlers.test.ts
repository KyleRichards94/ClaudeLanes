import { describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createClaudeLauncher } from './claude-sdk';
import { createAgentHandlers } from './handlers';
import { createSessionManager } from './session-manager';
import { createFakeClaude, fakeInit } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

describe('agent IPC handlers', () => {
  it("agent:getStatus returns the ticket's session status, never its credential", async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
    const sessions = createSessionManager({
      claude,
      connections: fakeClaudeConnections('api-key', 'sk-ant-test-3333-not-a-real-key-3333-Qw78'),
      tickets: await memoryTickets({ id: '71273' }),
      emit: recordingEmit().emit,
    });
    const handlers = createAgentHandlers({ sessions });

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
    const handlers = createAgentHandlers({
      sessions: createSessionManager({
        claude: createClaudeLauncher({ executable: () => null }),
        connections: fakeClaudeConnections(),
        tickets: await memoryTickets(),
        emit: recordingEmit().emit,
      }),
    });
    await expect(handleInvoke('agent:getStatus', { ticketId: '../etc' }, handlers['agent:getStatus'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(handleInvoke('agent:getStatus', undefined, handlers['agent:getStatus'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
