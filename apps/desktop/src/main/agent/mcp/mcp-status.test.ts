import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { McpStatusEventSchema } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../claude-sdk';
import { createSessionManager } from '../session-manager';
import { createFakeClaude, fakeInit } from '../testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from '../testing/sessions';
import { createMcpStatusMonitor, summariseMcpStatus } from './mcp-status';

const connected = (name: string): McpServerStatus => ({ name, status: 'connected' });
const failed = (name: string, error = 'spawn npx ENOENT'): McpServerStatus => ({ name, status: 'failed', error });

async function setup(statuses: Record<string, McpServerStatus[]>) {
  const fake = createFakeClaude((call) => {
    const ticketId = String(call.options.cwd).split(/[\\/]/).pop() ?? '';
    return { live: true, messages: [fakeInit(`session-${ticketId}`)], mcpStatus: statuses[ticketId] ?? [] };
  });
  const tickets = await memoryTickets({ id: '71273' }, { id: '71288' });
  const events = recordingEmit();
  const sessions = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: events.emit,
  });
  const monitor = createMcpStatusMonitor({ sessions, emit: events.emit, intervalMs: 0 });
  return { fake, sessions, monitor, events };
}

describe('MCP status for the header pill (AL-108)', () => {
  it('is none while no session runs, then online when every server is connected', async () => {
    const { sessions, monitor, events } = await setup({ '71273': [connected('agent_lanes'), connected('azure-devops')] });
    expect(monitor.summary()).toEqual({ state: 'none', servers: [] });

    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => monitor.summary().servers.length === 2 && monitor.summary().servers.every((server) => server.state === 'connected'));

    expect(monitor.summary()).toEqual({
      state: 'online',
      servers: [
        { name: 'agent_lanes', state: 'connected', error: null, ticketIds: ['71273'] },
        { name: 'azure-devops', state: 'connected', error: null, ticketIds: ['71273'] },
      ],
    });
    const last = events.of('agent:mcpStatus').at(-1);
    expect(McpStatusEventSchema.parse({ ...last, at: 1 }).state).toBe('online');
    monitor.dispose();
  });

  it('reconnects a failing server once, and turns the pill amber with its name when it keeps failing', async () => {
    const { fake, sessions, monitor, events } = await setup({ '71273': [connected('agent_lanes'), failed('github', 'Connection closed')] });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => monitor.summary().state === 'failing');

    expect(fake.calls[0]!.reconnects).toEqual(['github']);
    expect(monitor.summary().servers[0]).toEqual({ name: 'github', state: 'failed', error: 'Connection closed', ticketIds: ['71273'] });

    // Later reads do not reconnect again while it keeps failing.
    await monitor.refresh();
    expect(fake.calls[0]!.reconnects).toEqual(['github']);
    expect(events.of('agent:mcpStatus').at(-1)?.['state']).toBe('failing');
    monitor.dispose();
  });

  it('goes back to online when the reconnect brings the server back', async () => {
    const { fake, sessions, monitor } = await setup({ '71273': [failed('github')] });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    const call = fake.calls[0]!;
    // The fake's reconnect fixes the server.
    const reconnect = call.reconnects.push.bind(call.reconnects);
    call.reconnects.push = (...names: string[]) => {
      call.mcpStatus = [connected('github')];
      return reconnect(...names);
    };
    await eventually(() => monitor.summary().state === 'online' && call.reconnects.length === 1);
    expect(monitor.summary().servers).toEqual([{ name: 'github', state: 'connected', error: null, ticketIds: ['71273'] }]);
    monitor.dispose();
  });

  it("drops a session's servers when it stops", async () => {
    const { sessions, monitor, events } = await setup({ '71273': [connected('azure-devops')] });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => monitor.summary().state === 'online');
    await sessions.stop('71273');
    await monitor.refresh();
    expect(monitor.summary()).toEqual({ state: 'none', servers: [] });
    expect(events.of('agent:mcpStatus').at(-1)).toEqual({ state: 'none', servers: [] });
    monitor.dispose();
  });

  it('merges servers across sessions: the worst state wins and every ticket is listed', () => {
    const summary = summariseMcpStatus(
      new Map([
        ['71273', [{ name: 'azure-devops', state: 'connected' as const, error: null }]],
        ['71288', [{ name: 'azure-devops', state: 'failed' as const, error: '401' }, { name: 'agent_lanes', state: 'pending' as const, error: null }]],
      ]),
    );
    expect(summary).toEqual({
      state: 'failing',
      servers: [
        { name: 'azure-devops', state: 'failed', error: '401', ticketIds: ['71273', '71288'] },
        { name: 'agent_lanes', state: 'pending', error: null, ticketIds: ['71288'] },
      ],
    });
  });
});
