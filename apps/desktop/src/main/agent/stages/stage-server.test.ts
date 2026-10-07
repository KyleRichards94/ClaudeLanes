import type { McpServerConfig, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { STAGES, defaultStageGates, type StageGates } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher, loadClaudeSdk } from '../claude-sdk';
import { createSessionManager } from '../session-manager';
import { createFakeClaude, fakeInit } from '../testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from '../testing/sessions';
import { STAGE_PROTOCOL, STAGE_PROTOCOL_REMINDER, STAGE_SERVER_TOOLS, sdkStageServer, stageServerTools, stageSessionExtras } from './stage-server';
import { createStageService } from './stage-service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the handlers take each tool's own input
type AnyTool = SdkMcpToolDefinition<any>;

const ALL_AUTO = Object.fromEntries(STAGES.map((stage) => [stage, 'auto'])) as StageGates;

/** No gates unless a test passes them (AL-104 has its own tests below). */
async function setup(stage: 'queued' | 'planning' = 'planning', gates: StageGates = ALL_AUTO) {
  const tickets = await memoryTickets({ id: '71273', stage, gates });
  const events = recordingEmit();
  const stages = createStageService({ tickets, emit: events.emit, userName: () => 'Kyle' });
  const tools = stageServerTools('71273', stages) as AnyTool[];
  const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
  return { tickets, events, stages, tool };
}

describe('agent_lanes MCP server tools (AL-103)', () => {
  it('set_stage moves the card and tells the agent', async () => {
    const { tickets, events, tool } = await setup('planning');
    const result = await tool('set_stage').handler({ stage: 'implementing', summary: 'Plan approved' }, {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'Moved to Implementing.' }] });
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    expect(events.of('agent:stage')).toHaveLength(1);
  });

  it('rejects an invalid stage transition with a tool error the agent can read', async () => {
    const { tickets, events, tool } = await setup('planning');
    const result = await tool('set_stage').handler({ stage: 'create-pr', summary: 'Ship it' }, {});
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('Cannot move from Planning to Create PR. From Planning you can move to "implementing"') }],
    });
    expect((await tickets.get('71273'))?.stage).toBe('planning');
    expect(events.events).toEqual([]);
  });

  it('report_activity takes a percentage and drives the card activity and progress', async () => {
    const { events, tool } = await setup('planning');
    await expect(tool('report_activity').handler({ text: 'Mapping child modals', progress: 46 }, {})).resolves.toEqual({ content: [{ type: 'text', text: 'Noted.' }] });
    await tool('report_activity').handler({ text: 'Reading the grid' }, {});
    expect(events.of('agent:stage')).toEqual([
      expect.objectContaining({ change: 'activity', activity: 'Mapping child modals', progress: 0.46 }),
      expect.objectContaining({ change: 'activity', activity: 'Reading the grid', progress: null }),
    ]);
  });

  it('builds a server the real Agent SDK accepts, with both tools', async () => {
    const { stages } = await setup();
    const config = (await sdkStageServer(loadClaudeSdk)(stageServerTools('71273', stages))) as Extract<McpServerConfig, { type: 'sdk' }>;
    expect(config).toMatchObject({ type: 'sdk', name: 'agent_lanes' });
    expect(config.instance).toBeDefined();
  });
});

describe('stage tracking in a ticket session (AL-103)', () => {
  it('gives every session the agent_lanes server, its tools without prompts and the protocol, and moves Queued to Planning', async () => {
    const { tickets, events, stages } = await setup('queued');
    const fakeServer = { type: 'sdk', name: 'agent_lanes', instance: {} } as unknown as McpServerConfig;
    const servers: AnyTool[][] = [];
    const extras = stageSessionExtras({
      stages,
      createServer: (tools) => {
        servers.push(tools as AnyTool[]);
        return fakeServer;
      },
    });
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit: events.emit,
      extras,
    });

    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);

    const options = fake.calls[0]!.options;
    expect(options.mcpServers).toEqual({ agent_lanes: fakeServer });
    expect(options.allowedTools).toEqual([...STAGE_SERVER_TOOLS]);
    expect(STAGE_SERVER_TOOLS).toEqual(['mcp__agent_lanes__set_stage', 'mcp__agent_lanes__report_activity']);
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: STAGE_PROTOCOL });
    expect(String(fake.calls[0]!.sent[0]!.message.content)).toContain(STAGE_PROTOCOL_REMINDER);
    expect(servers[0]!.map((tool) => tool.name)).toEqual(['set_stage', 'report_activity']);
    expect((await tickets.get('71273'))?.stage).toBe('planning');
    expect(events.of('agent:stage')).toEqual([expect.objectContaining({ stage: 'planning', from: 'queued' })]);

    // The server's tools act on this session's ticket.
    await servers[0]![0]!.handler({ stage: 'implementing', summary: 'Plan ready' }, {});
    await eventually(() => events.of('agent:stage').length === 2);
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    await sessions.dispose();
  });

  it('describes the stage loop in the protocol', () => {
    expect(STAGE_PROTOCOL).toContain('set_stage');
    expect(STAGE_PROTOCOL).toContain('Code review and QA may send the work back to Implementing');
    expect(STAGE_PROTOCOL).toContain('"planning", "implementing", "code-review", "qa", "create-pr"');
    expect(STAGE_PROTOCOL).toContain("need the user's approval");
  });
});

describe('set_stage through a stage gate (AL-104)', () => {
  it('while the gate waits the session makes no request and the card is amber; Approve returns "approved"', async () => {
    const { tickets, events, stages } = await setup('planning', defaultStageGates());
    const servers: AnyTool[][] = [];
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit: events.emit,
      extras: stageSessionExtras({
        stages,
        createServer: (tools) => {
          servers.push(tools as AnyTool[]);
          return { type: 'sdk', name: 'agent_lanes', instance: {} } as unknown as McpServerConfig;
        },
      }),
    });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    const outputBefore = events.of('agent:output').length;

    // The CLI calls set_stage; the call stays open while the user decides.
    let answered = false;
    const call = servers[0]![0]!.handler({ stage: 'implementing', summary: 'Plan ready' }, { signal: new AbortController().signal }).then((result) => {
      answered = true;
      return result;
    });
    await eventually(() => stages.pendingGate('71273') !== null);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(answered).toBe(false);
    expect(events.of('agent:gate', '71273')).toEqual([expect.objectContaining({ state: 'waiting', stage: 'planning' })]);
    // Nothing was sent to the session, and it produced nothing: no request, so no tokens.
    expect(fake.calls[0]!.sent).toHaveLength(1);
    expect(events.of('agent:output').length).toBe(outputBefore);
    expect(fake.calls[0]!.closed).toBe(false);

    stages.resolveGate('71273', { approve: true });
    await expect(call).resolves.toEqual({ content: [{ type: 'text', text: 'Approved by Kyle. Moved to Implementing.' }] });
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    await sessions.dispose();
  });

  it('tells the agent what to change, and that an interrupted gate did not move it', async () => {
    const { stages, tool } = await setup('planning', defaultStageGates());
    const changes = tool('set_stage').handler({ stage: 'implementing', summary: 'Plan ready' }, {});
    await eventually(() => stages.pendingGate('71273') !== null);
    stages.resolveGate('71273', { approve: false, note: 'Keep frmJobNotes in WinForms.' });
    await expect(changes).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: 'Not approved. Kyle asked for changes before the move:\nKeep frmJobNotes in WinForms.\nStay in Planning, make the changes, then call set_stage again.',
        },
      ],
    });

    const abort = new AbortController();
    const interrupted = tool('set_stage').handler({ stage: 'implementing', summary: 'Plan v2' }, { signal: abort.signal });
    await eventually(() => stages.pendingGate('71273') !== null);
    abort.abort();
    await expect(interrupted).resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining('You are still in Planning') }] });
  });

  it('closes a waiting gate when the session ends', async () => {
    const { tickets, events, stages, tool } = await setup('planning', defaultStageGates());
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit: events.emit,
      onEnded: (ticketId) => stages.cancelGate(ticketId),
    });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    const call = tool('set_stage').handler({ stage: 'implementing', summary: 'Plan ready' }, {});
    await eventually(() => stages.pendingGate('71273') !== null);

    await sessions.stop('71273');
    await expect(call).resolves.toMatchObject({ isError: true });
    expect(stages.pendingGate('71273')).toBeNull();
    expect(events.of('agent:gate').at(-1)).toMatchObject({ state: 'cancelled' });
  });
});
