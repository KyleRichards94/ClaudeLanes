import type { AgentOutputEvent, AgentOutputItem, SubagentNode } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { deriveActivity, isTestCommand } from './activity';
import { LEAD_AGENT_COLOR, SUB_AGENT_COLORS, UNKNOWN_AGENT_COLOR, agentColor, assignAgentColors } from './colors';
import { agentById, deriveAgents, latestActiveFile, sessionStatus, subAgentStatus } from './derive-agents';

const T = '71273';
let seq = 0;
function ev(item: Partial<AgentOutputItem> & { kind: AgentOutputItem['kind'] }, at: number, ticketId = T): AgentOutputEvent {
  return { ticketId, at, seq: (seq += 1), item: { parentToolUseId: null, ...item } as AgentOutputItem };
}
const tool = (rowId: string, kind: 'read' | 'edit' | 'write' | 'grep' | 'glob' | 'bash' | 'other', detail: string, at: number, parent: string | null = null, ticketId = T) =>
  ev({ kind: 'tool', rowId, toolUseIds: [rowId], tool: kind, label: kind, detail, stats: null, parentToolUseId: parent }, at, ticketId);
const result = (at: number, ticketId = T) =>
  ev({ kind: 'result', subtype: 'success', isError: false, durationMs: 1, numTurns: 1, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }, at, ticketId);

function node(id: string, overrides: Partial<SubagentNode> = {}): SubagentNode {
  return {
    id,
    taskId: null,
    parentId: null,
    name: id,
    agentType: null,
    description: '',
    model: null,
    effort: null,
    status: 'running',
    activity: null,
    tokens: null,
    branch: null,
    readOnly: false,
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  };
}

describe('agent colours (AL-278)', () => {
  it('keeps the lead violet and takes the next colour in spawn order, repeating after six', () => {
    expect(agentColor('lead')).toBe('#5B4BC4');
    expect(LEAD_AGENT_COLOR).toBe('#5B4BC4');
    expect(SUB_AGENT_COLORS).toEqual(['#0369A1', '#0D9488', '#7C3AED', '#B45309', '#DB2777', '#64748B']);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => agentColor('sub', index))).toEqual([...SUB_AGENT_COLORS, '#0369A1', '#0D9488']);
    expect(agentColor('sub')).toBe(UNKNOWN_AGENT_COLOR);
    expect(UNKNOWN_AGENT_COLOR).toBe('#94A3B8');
  });

  it('assigns by start time, whatever order the list is in, and a later agent changes no one else’s colour', () => {
    const early = [
      { id: 'b', startedAt: 20 },
      { id: 'a', startedAt: 10 },
    ];
    const before = assignAgentColors(early);
    expect(before.get('a')).toBe('#0369A1');
    expect(before.get('b')).toBe('#0D9488');
    const after = assignAgentColors([...early, { id: 'c', startedAt: 30 }]);
    expect(after.get('a')).toBe(before.get('a'));
    expect(after.get('b')).toBe(before.get('b'));
    expect(after.get('c')).toBe('#7C3AED');
  });
});

describe('deriveActivity (AL-278)', () => {
  it('keeps each agent’s newest read, edit or write, with edit and write as edit', () => {
    const activity = deriveActivity([
      tool('1', 'read', 'src/A.cs', 100),
      tool('2', 'edit', 'src\\B.cs', 200),
      tool('3', 'write', './src/C.cs', 300, 'toolu_sub'),
      tool('4', 'read', 'src/D.cs', 400, 'toolu_sub'),
    ]);
    expect(activity.get(T)).toEqual({ file: 'src/B.cs', kind: 'edit', at: 200 });
    expect(activity.get('toolu_sub')).toEqual({ file: 'src/D.cs', kind: 'read', at: 400 });
  });

  it('treats a search as reading no file, and a test run as testing', () => {
    expect(deriveActivity([tool('1', 'grep', 'TODO in src', 1)]).get(T)).toEqual({ file: null, kind: 'read', at: 1 });
    expect(deriveActivity([tool('1', 'glob', '**/*.cs', 1)]).get(T)).toEqual({ file: null, kind: 'read', at: 1 });
    expect(deriveActivity([tool('1', 'bash', 'dotnet test OnSite.sln', 5)]).get(T)).toEqual({ file: null, kind: 'test', at: 5 });
  });

  it('leaves activity alone for other Bash commands and other tools', () => {
    const activity = deriveActivity([tool('1', 'edit', 'a.cs', 1), tool('2', 'bash', 'git status', 2), tool('3', 'other', 'Skill', 3)]);
    expect(activity.get(T)).toEqual({ file: 'a.cs', kind: 'edit', at: 1 });
  });

  it('clears the lead when its turn ends, and a second agent by its own ticket', () => {
    const activity = deriveActivity([
      tool('1', 'edit', 'a.cs', 1),
      tool('2', 'read', 'r.cs', 2, null, '71273-reviewer'),
      result(3),
      tool('3', 'read', 'b.cs', 4, 'toolu_sub'),
    ]);
    expect(activity.has(T)).toBe(false);
    expect(activity.get('71273-reviewer')).toEqual({ file: 'r.cs', kind: 'read', at: 2 });
    // A sub-agent's activity outlives the lead's result; it ends with the sub-agent.
    expect(activity.get('toolu_sub')).toMatchObject({ file: 'b.cs' });
  });

  it('recognises test runs', () => {
    for (const command of ['dotnet test', 'pnpm vitest run src', 'npm run test', 'pytest -q', 'go test ./...', 'pnpm e2e']) expect(isTestCommand(command)).toBe(true);
    for (const command of ['dotnet build', 'git commit -m "tests"', 'ls tests']) expect(isTestCommand(command)).toBe(false);
  });
});

describe('agent status', () => {
  it('maps a session state: working is running, finished is done, lost is an error, the rest wait', () => {
    expect(sessionStatus('running')).toBe('running');
    expect(sessionStatus('starting')).toBe('running');
    expect(['idle', 'paused', 'queued', 'none'].map((state) => sessionStatus(state as never))).toEqual(['idle', 'idle', 'idle', 'idle']);
    expect(sessionStatus('stopped')).toBe('done');
    expect(sessionStatus('lost')).toBe('error');
  });

  it('maps a sub-agent status: queued waits, failed is an error', () => {
    expect(['queued', 'running', 'done', 'failed'].map((status) => subAgentStatus(status as never))).toEqual(['idle', 'running', 'done', 'error']);
  });
});

describe('deriveAgents (AL-278)', () => {
  const lead = { id: T, model: 'opus' as const, branch: '71273-cutover', session: 'running' as const, tokens: 212_000 };

  it('lists the lead first, then sub-agents and second agents in spawn order, each with its colour', () => {
    const agents = deriveAgents({
      lead,
      subAgents: [node('toolu_b', { name: 'test-writer', startedAt: 3_000, model: 'haiku' }), node('toolu_a', { name: 'razor-writer', startedAt: 1_000, branch: 'sub/71273-grid', tokens: 5_000 })],
      companions: [{ id: '71273-reviewer', name: 'reviewer', role: 'reviewer', model: 'sonnet', branch: null, session: 'idle', startedAt: 2_000 }],
      events: [],
    });
    expect(agents.map((agent) => [agent.id, agent.name, agent.role, agent.color, agent.model])).toEqual([
      [T, 'Lead', 'lead', '#5B4BC4', 'Opus'],
      ['toolu_a', 'razor-writer', 'sub', '#0369A1', 'Opus'],
      ['71273-reviewer', 'reviewer', 'reviewer', '#0D9488', 'Sonnet'],
      ['toolu_b', 'test-writer', 'sub', '#7C3AED', 'Haiku'],
    ]);
    expect(agents[1]).toMatchObject({ tokens: 5_000, branch: 'sub/71273-grid' });
    expect(agents[0]).toMatchObject({ tokens: 212_000, branch: '71273-cutover' });
    expect(agentById(agents, 'toolu_b')?.name).toBe('test-writer');
    expect(agentById(agents, null)).toBeUndefined();
    expect(agentById(agents, 'gone')).toBeUndefined();
  });

  it('puts each running agent on the file it last touched, and a reviewer’s reading is a review', () => {
    const agents = deriveAgents({
      lead,
      subAgents: [node('toolu_a', { name: 'razor-writer' }), node('toolu_r', { name: 'code-reviewer', startedAt: 2_000 })],
      events: [tool('1', 'edit', 'src/Grid.razor', 100), tool('2', 'edit', 'src/Grid.razor.cs', 110, 'toolu_a'), tool('3', 'read', 'src/Grid.razor', 120, 'toolu_r')],
    });
    expect(agents.map((agent) => [agent.id, agent.activeFile, agent.activeKind])).toEqual([
      [T, 'src/Grid.razor', 'edit'],
      ['toolu_a', 'src/Grid.razor.cs', 'edit'],
      ['toolu_r', 'src/Grid.razor', 'review'],
    ]);
    expect(agents[2]!.role).toBe('reviewer');
  });

  it('clears the activity of an agent that is not running: turn over, sub-agent done, session ended', () => {
    const events = [tool('1', 'edit', 'a.cs', 100), tool('2', 'edit', 'b.cs', 110, 'toolu_a')];
    const idleLead = deriveAgents({ lead: { ...lead, session: 'idle' }, subAgents: [node('toolu_a', { status: 'done' })], events });
    expect(idleLead.map((agent) => [agent.status, agent.activeFile, agent.activeKind])).toEqual([
      ['idle', null, 'idle'],
      ['done', null, 'idle'],
    ]);
    const afterTurn = deriveAgents({ lead, subAgents: [], events: [...events, result(200)] });
    expect(afterTurn[0]).toMatchObject({ status: 'running', activeFile: null, activeKind: 'idle' });
    const ended = deriveAgents({ lead: { ...lead, session: 'stopped' }, subAgents: [], events });
    expect(ended[0]).toMatchObject({ status: 'done', activeFile: null });
  });

  it('shows a second agent’s activity from its own stream', () => {
    const agents = deriveAgents({
      lead: { ...lead, session: 'idle' },
      subAgents: [],
      companions: [{ id: '71273-helper', name: 'helper', role: 'helper', model: 'sonnet', branch: 'sub/71273-helper', session: 'running', startedAt: 10 }],
      events: [tool('1', 'edit', 'h.cs', 100, null, '71273-helper')],
    });
    expect(agents[1]).toMatchObject({ role: 'helper', status: 'running', activeFile: 'h.cs', activeKind: 'edit', branch: 'sub/71273-helper' });
  });
});

describe('latestActiveFile (Follow agent)', () => {
  const lead = { id: T, model: 'opus' as const, branch: 'b', session: 'running' as const };

  it('takes the file of the newest edit or review among the running agents, never a plain read', () => {
    const agents = deriveAgents({
      lead,
      subAgents: [node('toolu_a', { name: 'razor-writer' }), node('toolu_b', { name: 'test-writer', startedAt: 2_000 })],
      events: [tool('1', 'edit', 'lead.cs', 100), tool('2', 'edit', 'sub-a.cs', 300, 'toolu_a'), tool('3', 'read', 'sub-b.cs', 400, 'toolu_b')],
    });
    expect(latestActiveFile(agents)).toBe('sub-a.cs');
    expect(agents.find((agent) => agent.id === 'toolu_a')?.activeAt).toBe(300);
  });

  it('is null when nobody is editing', () => {
    expect(latestActiveFile(deriveAgents({ lead, subAgents: [], events: [tool('1', 'read', 'a.cs', 1)] }))).toBeNull();
    expect(latestActiveFile([])).toBeNull();
  });
});
