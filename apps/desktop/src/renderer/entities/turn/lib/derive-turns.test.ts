import type { AgentOutputEvent, AgentOutputItem, TicketStageEntry } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { deriveTurns, firstSentence, stageAt, toolCountsLabel, turnStageOf, turnsCost } from './derive-turns';

const T = '71273';
let seq = 0;
function ev(item: Partial<AgentOutputItem> & { kind: AgentOutputItem['kind'] }, at: number, ticketId = T): AgentOutputEvent {
  return { ticketId, at, seq: (seq += 1), item: { parentToolUseId: null, ...item } as AgentOutputItem };
}

const user = (at: number, source: 'composer' | 'app' | 'app-note' | 'launch' = 'composer') => ev({ kind: 'user', messageId: null, text: 'go', priority: null, source }, at);
const tool = (rowId: string, label: string, at: number, parent: string | null = null) =>
  ev({ kind: 'tool', rowId, toolUseIds: [rowId], tool: 'other', label, detail: 'x', stats: null, parentToolUseId: parent }, at);
const text = (text: string, at: number, parent: string | null = null) => ev({ kind: 'text', streamId: `m${at}`, text, parentToolUseId: parent }, at);
const result = (at: number, costUsd: number, durationMs = 0) =>
  ev({ kind: 'result', subtype: 'success', isError: false, durationMs, numTurns: 1, costUsd, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }, at);

const history: TicketStageEntry[] = [
  { stage: 'queued', at: 0 },
  { stage: 'planning', at: 100 },
  { stage: 'implementing', at: 2_000 },
];

describe('deriveTurns (AL-278)', () => {
  it('starts a turn at the user message and ends it at the result, with its cost, tool counts and summary', () => {
    const turns = deriveTurns(
      [
        user(1_000),
        tool('a', 'Read', 1_100),
        tool('b', 'Edit', 1_200),
        tool('c', 'Edit', 1_300),
        text('Planned the grid. Next I will wire it.', 1_400),
        result(1_500, 0.31, 450),
        user(2_100),
        tool('d', 'Bash', 2_200),
        text('Built clean.\n\nAll green.', 2_300),
        result(2_400, 0.43, 300),
      ],
      history,
    );

    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      index: 1,
      leadAgentId: T,
      startedAt: 1_000,
      endedAt: 1_500,
      durationMs: 450,
      costUsd: 0.31,
      stage: 'planning',
      summary: 'Planned the grid.',
      toolCounts: { Read: 1, Edit: 2 },
    });
    expect(turns[1]).toMatchObject({ index: 2, stage: 'implementing', summary: 'Built clean.', toolCounts: { Bash: 1 } });
    // Each result carries the session's running total: a turn's own cost is the change since the last.
    expect(turns[1]!.costUsd).toBeCloseTo(0.12);
    expect(turnsCost(turns)).toBeCloseTo(0.43);
  });

  it('leaves the turn with no result yet live: no end, no cost, running to its newest event', () => {
    const turns = deriveTurns([user(1_000), tool('a', 'Edit', 1_200), text('Working on it', 1_900)], history);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ index: 1, endedAt: null, durationMs: 900, costUsd: 0, summary: 'Working on it' });
  });

  it('names the agent that ran most tool calls as the turn’s lead, the ticket on a tie', () => {
    const turns = deriveTurns(
      [
        user(1_000),
        tool('a', 'Read', 1_010),
        tool('b', 'Edit', 1_020, 'toolu_writer'),
        tool('c', 'Edit', 1_030, 'toolu_writer'),
        tool('d', 'Edit', 1_040, 'toolu_writer'),
        result(1_100, 0),
        user(1_200),
        tool('e', 'Read', 1_210),
        tool('f', 'Read', 1_220, 'toolu_writer'),
        result(1_300, 0),
      ],
      history,
    );
    expect(turns.map((turn) => turn.leadAgentId)).toEqual(['toolu_writer', T]);
  });

  it('counts a tool row once however often it is updated, and only the lead’s prose as the summary', () => {
    const turns = deriveTurns(
      [user(1_000), tool('a', 'Spawn', 1_010), tool('a', 'Spawn', 1_020), text('Sub-agent chatter. More.', 1_030, 'toolu_x'), text('Lead summary here. And more.', 1_040), result(1_100, 0)],
      history,
    );
    expect(turns[0]).toMatchObject({ toolCounts: { Spawn: 1 }, summary: 'Lead summary here.' });
  });

  it('does not start a turn at the app’s own messages, but at the work that follows them', () => {
    const turns = deriveTurns([user(1_000), result(1_100, 0.1), user(1_200, 'app'), tool('a', 'Bash', 1_250), result(1_300, 0.2)], history);
    expect(turns.map((turn) => [turn.startedAt, turn.endedAt])).toEqual([
      [1_000, 1_100],
      [1_250, 1_300],
    ]);
    // A pushed note ("Agent Lanes · build result") is a turn of its own.
    expect(deriveTurns([user(1_000, 'app-note'), result(1_100, 0)], history)).toHaveLength(1);
  });

  it('keeps a queued or steering message inside the turn it arrives in, and ignores a sub-agent’s result', () => {
    const turns = deriveTurns([user(1_000), tool('a', 'Edit', 1_010), user(1_020), result(1_030, 0.1, 0, ), result(1_040, 0.05)], history);
    expect(turns).toHaveLength(2);
    const subResult = ev({ kind: 'result', subtype: 'success', isError: false, durationMs: 1, numTurns: 1, costUsd: 9, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, parentToolUseId: 'toolu_x' }, 1_015);
    const merged = deriveTurns([user(1_000), tool('a', 'Edit', 1_010), subResult, result(1_030, 0.1)], history);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.costUsd).toBe(0.1);
  });

  it('copes with a stream cut short before the turn started, and with no events', () => {
    const turns = deriveTurns([tool('a', 'Edit', 5_000), result(5_100, 0.5, 400)], history);
    expect(turns[0]).toMatchObject({ index: 1, startedAt: 5_000, endedAt: 5_100, durationMs: 400 });
    expect(deriveTurns([result(5_100, 0.5, 400)], history)[0]).toMatchObject({ startedAt: 4_700, endedAt: 5_100 });
    expect(deriveTurns([], history)).toEqual([]);
  });
});

describe('turn stage', () => {
  it('maps lanes to the five turn stages, single-step lanes to the stage they do', () => {
    expect([turnStageOf('planning'), turnStageOf('code-review'), turnStageOf('review-only'), turnStageOf('qa-only'), turnStageOf('create-pr'), turnStageOf('pr-only'), turnStageOf('comments-only')]).toEqual([
      'planning',
      'codeReview',
      'codeReview',
      'qa',
      'createPr',
      'createPr',
      'implementing',
    ]);
  });

  it('takes the stage the ticket was in when the turn started, the first one for a turn before the history', () => {
    expect(stageAt(history, 50)).toBe('planning');
    expect(stageAt(history, 100)).toBe('planning');
    expect(stageAt(history, 1_999)).toBe('planning');
    expect(stageAt(history, 2_000)).toBe('implementing');
    expect(stageAt([], 5)).toBe('planning');
  });
});

describe('turn summaries and tool chips', () => {
  it('takes the first sentence without markdown, clipped to one line', () => {
    expect(firstSentence('**Done.** The grid now sorts.')).toBe('Done.');
    expect(firstSentence('## Plan\n- Wire the grid. Then test it.')).toBe('Plan');
    expect(firstSentence('I am cutting over `frmJobFilter` now\nthen the next one')).toBe('I am cutting over frmJobFilter now');
    expect(firstSentence('')).toBe('');
    expect(firstSentence('x'.repeat(300))).toHaveLength(140);
  });

  it('writes the chip with the busiest two tools', () => {
    expect(toolCountsLabel({ Edit: 3, Bash: 4, Read: 1 })).toBe('Bash 4 · Edit 3');
    expect(toolCountsLabel({})).toBe('');
  });
});
