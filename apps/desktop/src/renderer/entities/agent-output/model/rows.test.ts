import type { AgentOutputItem } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fakeOutputEvent } from '@/shared/testing';
import { displayRows, findToolUse, groupTurns, liveTexts, outputRows, proseSpans, statSpans, turnEndLabel, turnRowKey, userCaption, withLiveText, withoutThinking, type OutputRow } from './rows';
import { createAgentOutputStore } from './store';
import { estimateRowHeight, heightChange, rowOffsets, windowFor } from './virtual';

let seq = 0;
function event(item: AgentOutputItem, at = 1_000) {
  seq += 1;
  return fakeOutputEvent('71273', at, { seq, item });
}

const lead = { parentToolUseId: null };

function tool(rowId: string, overrides: Partial<Extract<AgentOutputItem, { kind: 'tool' }>> = {}): AgentOutputItem {
  return { kind: 'tool', rowId, toolUseIds: [rowId], tool: 'read', label: 'Read', detail: 'OnSite/Forms/frmJobControl.vb', stats: null, ...lead, ...overrides };
}

describe('outputRows (AL-175)', () => {
  it('folds the artboard 3 output into system, tool, prose and streaming rows', () => {
    const at = new Date(2026, 9, 8, 13, 58).getTime();
    const rows = outputRows([
      event({ kind: 'system', text: 'Plan approved by Kyle · moved to Implementing', ...lead }, at),
      event(tool('toolu_1')),
      event({ kind: 'tool-result', rowId: 'toolu_1', toolUseId: 'toolu_1', isError: false, summary: '', stats: '1,842 lines', ...lead }),
      event({ kind: 'text', streamId: 'msg_1', text: 'frmJobControl opens 4 child modals. I am cutting over **frmJobFilter**.', ...lead }),
      event(tool('spawn_1', { tool: 'spawn', label: 'Spawn', detail: 'explore', stats: '1 sub-agent' })),
      event(tool('spawn_1', { tool: 'spawn', label: 'Spawn', toolUseIds: ['a', 'b', 'c'], detail: 'explore · razor-writer · test-writer', stats: '3 sub-agents' })),
      event(tool('toolu_2', { tool: 'edit', label: 'Edit', detail: 'Pages/Jobs/JobControl.razor', stats: '+214 −0' })),
      event({ kind: 'text-delta', streamId: 'msg_2', text: 'Wiring the job grid ', ...lead }),
      event({ kind: 'text-delta', streamId: 'msg_2', text: 'filters to JobFilterState', ...lead }),
    ]);

    expect(rows.map((row) => row.type)).toEqual(['system', 'tool', 'prose', 'tool', 'tool', 'streaming']);
    expect(rows[0]).toMatchObject({ type: 'system', at, text: 'Plan approved by Kyle · moved to Implementing' });
    expect(rows[1]).toMatchObject({ label: 'Read', stats: '1,842 lines', isError: false });
    // The Spawn row gained its other sub-agents in place.
    expect(rows[3]).toMatchObject({ label: 'Spawn', detail: 'explore · razor-writer · test-writer', stats: '3 sub-agents' });
    expect(rows[5]).toMatchObject({ type: 'streaming', text: 'Wiring the job grid filters to JobFilterState', live: true });
  });

  it('replaces the streaming line with its finished text, in place', () => {
    const rows = outputRows([
      event({ kind: 'text-delta', streamId: 'msg_9', text: 'Half a ', ...lead }),
      event(tool('toolu_9')),
      event({ kind: 'text', streamId: 'msg_9', text: 'Half a sentence, now whole.', ...lead }),
    ]);
    expect(rows.map((row) => row.type)).toEqual(['prose', 'tool']);
    expect(rows[0]).toMatchObject({ text: 'Half a sentence, now whole.' });
  });

  it('shows an older unfinished stream as prose; only the newest row has the caret', () => {
    const rows = outputRows([
      event({ kind: 'text-delta', streamId: 'msg_1', text: 'Interrupted', ...lead }),
      event({ kind: 'system', text: 'Paused by Kyle', ...lead }),
    ]);
    expect(rows[0]).toMatchObject({ type: 'streaming', live: false });
  });

  it('marks a failed tool and keeps stats a later replacement leaves out', () => {
    const rows = outputRows([
      event(tool('toolu_3', { tool: 'bash', label: 'Bash', detail: 'dotnet build OnSite.Blazor.csproj' })),
      event({ kind: 'tool-result', rowId: 'toolu_3', toolUseId: 'toolu_3', isError: true, summary: 'exit 1', stats: '3 errors · 2 warnings', ...lead }),
      event(tool('toolu_3', { tool: 'bash', label: 'Bash', detail: 'dotnet build OnSite.Blazor.csproj' })),
    ]);
    expect(rows).toEqual([expect.objectContaining({ type: 'tool', isError: true, stats: '3 errors · 2 warnings' })]);
  });

  it("leaves sub-agents' output to the sub-agents tree and draws turn ends and failed turns", () => {
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    const rows = outputRows([
      event({ kind: 'text', streamId: 'msg_s', text: 'From razor-writer', parentToolUseId: 'toolu_spawn' }),
      event({ kind: 'result', subtype: 'success', isError: false, durationMs: 1, numTurns: 1, costUsd: 0, usage, ...lead }),
      event({ kind: 'result', subtype: 'error_max_turns', isError: true, durationMs: 1, numTurns: 1, costUsd: 0, usage, ...lead }),
      event({ kind: 'text', streamId: 'msg_e', text: '   ', ...lead }),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ type: 'turn-end', durationMs: 1, costUsd: 0, live: false }),
      expect.objectContaining({ type: 'failed', text: 'Turn ended early · error max turns' }),
    ]);
  });
});

describe('proseSpans and statSpans', () => {
  it('bolds **names** and sets `code` in mono', () => {
    expect(proseSpans('Keeping **frmJobAttachments** and `IWinFormsInvoker` as is')).toEqual([
      { text: 'Keeping ', style: 'plain' },
      { text: 'frmJobAttachments', style: 'bold' },
      { text: ' and ', style: 'plain' },
      { text: 'IWinFormsInvoker', style: 'code' },
      { text: ' as is', style: 'plain' },
    ]);
    expect(proseSpans('2 ** 3 is not bold')).toEqual([{ text: '2 ** 3 is not bold', style: 'plain' }]);
  });

  it('tints added, removed, clean and failing stats', () => {
    expect(statSpans('+214 −0')).toEqual([
      { text: '+214', tone: 'added' },
      { text: '−0', tone: 'removed' },
    ]);
    expect(statSpans('0 errors · 2 warnings')).toEqual([
      { text: '0 errors', tone: 'ok' },
      { text: '2 warnings', tone: 'plain' },
    ]);
    expect(statSpans('3 errors')).toEqual([{ text: '3 errors', tone: 'error' }]);
    expect(statSpans('1,842 lines')).toEqual([{ text: '1,842 lines', tone: 'plain' }]);
  });
});

describe('output windowing', () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => ({
    type: 'tool' as const,
    key: `t${index}`,
    toolUseIds: [`t${index}`],
    tool: 'read' as const,
    label: 'Read',
    detail: `file ${index}`,
    stats: null,
    isError: false,
    input: null,
    edit: null,
    output: null,
    subagents: [],
  }));

  it('keeps each row at its measured height once drawn, its estimate before', () => {
    const height = estimateRowHeight(rows[0]!);
    const offsets = rowOffsets(rows.slice(0, 3), new Map([['t1', 100]]));
    expect([...offsets]).toEqual([0, height, height + 100, 2 * height + 100]);
    expect(estimateRowHeight({ type: 'prose', key: 'p', text: 'x'.repeat(2_000) })).toBeGreaterThan(estimateRowHeight({ type: 'prose', key: 'q', text: 'short' }));
  });

  it('draws a few dozen of 10,000 rows at any scroll position', () => {
    const offsets = rowOffsets(rows, new Map());
    const total = offsets[rows.length]!;
    for (const top of [0, total / 2, total - 600]) {
      const { start, end } = windowFor(offsets, rows.length, top, 600);
      expect(end - start).toBeLessThan(80);
      expect(offsets[start]!).toBeLessThanOrEqual(Math.max(top - 800, 0));
      expect(offsets[end] ?? total).toBeGreaterThanOrEqual(Math.min(top + 600, total));
    }
    expect(windowFor(offsets, 0, 0, 600)).toEqual({ start: 0, end: 0 });
  });

  it('applies a new height, holds back the followed newest row’s growth, and ignores noise', () => {
    // Never measured: always applied, even for the row being followed.
    expect(heightChange(undefined, 40, true)).toBe('apply');
    expect(heightChange(40, 80, false)).toBe('apply');
    expect(heightChange(40, 80, true)).toBe('hold');
    expect(heightChange(40, 40.3, false)).toBe('ignore');
    expect(heightChange(40, 0, true)).toBe('ignore');
    expect(heightChange(undefined, 0, false)).toBe('ignore');
  });
});

describe("the user's messages and turn ends (AL-251)", () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const at = new Date(2026, 9, 9, 14, 2).getTime();

  it('draws a user row per message and a turn-end row per successful result, the newest one live', () => {
    const rows = outputRows([
      event({ kind: 'user', messageId: 'u1', text: 'Cut it over', priority: 'next', source: 'launch', ...lead }, at),
      event({ kind: 'result', subtype: 'success', isError: false, durationMs: 72_000, numTurns: 1, costUsd: 0.42, usage, ...lead }, at),
      event({ kind: 'user', messageId: 'u2', text: '/code-review', priority: 'now', source: 'skill', ...lead }, at),
      event({ kind: 'result', subtype: 'success', isError: false, durationMs: 48_000, numTurns: 2, costUsd: 0.5, usage, ...lead }, at),
    ]);
    const keys = rows.map((row) => row.key);
    expect(rows).toEqual([
      { type: 'user', key: keys[0], at, text: 'Cut it over', source: 'launch', priority: 'next', messageId: 'u1' },
      { type: 'turn-end', key: keys[1], at, durationMs: 72_000, costUsd: 0.42, live: false },
      { type: 'user', key: keys[2], at, text: '/code-review', source: 'skill', priority: 'now', messageId: 'u2' },
      // The second turn's cost is the change in the running total.
      { type: 'turn-end', key: keys[3], at, durationMs: 48_000, costUsd: expect.closeTo(0.08, 5), live: true },
    ]);
    expect(turnEndLabel(rows[1] as Extract<OutputRow, { type: 'turn-end' }>)).toBe('Turn ended · 1m 12s · $0.42');
    expect(turnEndLabel(rows[3] as Extract<OutputRow, { type: 'turn-end' }>)).toBe('Turn ended · 48s · $0.08 · waiting for you');
    expect(userCaption({ source: 'launch', at, priority: 'next' })).toBe('Launched · 14:02');
    expect(userCaption({ source: 'skill', at, priority: 'now' })).toBe('Skill · 14:02 · steered now');
    expect(userCaption({ source: 'composer', at: 0, priority: null })).toBe('You');
    expect(estimateRowHeight(rows[0]!)).toBeGreaterThan(estimateRowHeight(rows[1]!));
  });
});

describe('sub-agent lanes (AL-261)', () => {
  type ToolRow = Extract<OutputRow, { type: 'tool' }>;

  it("nests two parallel sub-agents' rows under the right Spawn rows, with each one's latest line", () => {
    const rows = outputRows([
      event(tool('spawn_1', { tool: 'spawn', label: 'Spawn', toolUseIds: ['a'], names: ['explore'], detail: 'explore', stats: '1 sub-agent' })),
      event(tool('spawn_2', { tool: 'spawn', label: 'Spawn', toolUseIds: ['b'], names: ['writer'], detail: 'writer', stats: '1 sub-agent' })),
      event(tool('a_read', { parentToolUseId: 'a', detail: 'README.md' })),
      event(tool('b_edit', { parentToolUseId: 'b', tool: 'edit', label: 'Edit', detail: 'JobGrid.razor', stats: '+40 −0' })),
      event({ kind: 'text', streamId: 'a_msg', text: 'Found 4 forms', parentToolUseId: 'a' }),
      event({ kind: 'tool-result', rowId: 'b_edit', toolUseId: 'b_edit', isError: false, summary: '', stats: null, parentToolUseId: 'b' }),
      event({ kind: 'text-delta', streamId: 'b_msg', text: 'Wiring the grid', parentToolUseId: 'b' }),
    ]);
    expect(rows.map((row) => row.type)).toEqual(['tool', 'tool']);
    const [first, second] = rows as ToolRow[];
    expect(first!.subagents).toHaveLength(1);
    expect(first!.subagents[0]).toMatchObject({ toolUseId: 'a', name: 'explore', latest: 'Found 4 forms' });
    expect(first!.subagents[0]!.rows.map((row) => row.type)).toEqual(['tool', 'prose']);
    // Nested row keys carry the sub-agent's id, so open rows are remembered per lane.
    expect(first!.subagents[0]!.rows[0]).toMatchObject({ key: 'a/ta_read', detail: 'README.md' });
    expect(second!.subagents[0]).toMatchObject({ toolUseId: 'b', name: 'writer', latest: 'Wiring the grid' });
    expect(second!.subagents[0]!.rows.map((row) => row.type)).toEqual(['tool', 'streaming']);
    expect(second!.subagents[0]!.rows[1]).toMatchObject({ live: true });
  });

  it('nests a sub-agent spawned by a sub-agent, and finds the top-level row for any tool use', () => {
    const rows = outputRows([
      event(tool('spawn_1', { tool: 'spawn', label: 'Spawn', toolUseIds: ['a'], names: ['explore'], detail: 'explore', stats: '1 sub-agent' })),
      event(tool('spawn_2', { tool: 'spawn', label: 'Spawn', toolUseIds: ['c'], names: ['helper'], detail: 'helper', stats: '1 sub-agent', parentToolUseId: 'a' })),
      event(tool('c_read', { parentToolUseId: 'c', detail: 'Program.cs' })),
      // A lane whose Spawn row never arrived is left out.
      event(tool('lone', { parentToolUseId: 'ghost' })),
    ]);
    expect(rows).toHaveLength(1);
    const lane = (rows[0] as ToolRow).subagents[0]!;
    expect(lane.rows[0]).toMatchObject({ type: 'tool', tool: 'spawn' });
    expect((lane.rows[0] as ToolRow).subagents[0]).toMatchObject({ toolUseId: 'c', name: 'helper', latest: 'Read Program.cs' });
    expect(findToolUse(rows, 'c')).toEqual({ index: 0, expandKeys: ['tspawn_1', 'a/tspawn_2'] });
    expect(findToolUse(rows, 'a')).toEqual({ index: 0, expandKeys: ['tspawn_1'] });
    expect(findToolUse(rows, 'ghost')).toBeNull();
  });
});

describe('thinking rows (AL-262)', () => {
  it('streams thinking into one collapsed row, finishes it in place, and can be hidden', () => {
    const rows = outputRows([
      event({ kind: 'thinking-delta', streamId: 'msg_1', text: 'The grid ', ...lead }),
      event({ kind: 'thinking-delta', streamId: 'msg_1', text: 'filters…', ...lead }),
      event({ kind: 'thinking', streamId: 'msg_1', text: 'The grid filters live in JobFilterState.', ...lead }),
      event({ kind: 'text', streamId: 'msg_1', text: 'Wiring them now.', ...lead }),
      event({ kind: 'thinking-delta', streamId: 'msg_2', text: 'Next…', ...lead }),
    ]);
    expect(rows.map((row) => row.type)).toEqual(['thinking', 'prose', 'thinking']);
    expect(rows[0]).toMatchObject({ key: 'kmsg_1', text: 'The grid filters live in JobFilterState.', live: false });
    expect(rows[2]).toMatchObject({ text: 'Next…', live: true });
    expect(withoutThinking(rows).map((row) => row.type)).toEqual(['prose']);
  });
});

describe('app notes (AL-273)', () => {
  it('captions a note the app pushed as Agent Lanes', () => {
    expect(userCaption({ source: 'app-note', at: 0, priority: null })).toBe('Agent Lanes');
  });
});

describe('groupTurns and displayRows (AL-279, grouped output)', () => {
  const user = (text: string, source: 'composer' | 'app' = 'composer'): AgentOutputItem => ({ kind: 'user', text, source, priority: null, messageId: null, ...lead });
  const result = (): AgentOutputItem => ({ kind: 'result', subtype: 'success', isError: false, durationMs: 60_000, numTurns: 1, costUsd: 0.5, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, ...lead });

  const rows = outputRows([
    event({ kind: 'system', text: 'Plan approved', ...lead }),
    event(user('Add a filter')),
    event(tool('r1', { tool: 'edit', label: 'Edit' })),
    event({ kind: 'text', streamId: 'm1', text: 'Filter added.', ...lead }),
    event(result()),
    event(user('Continue where you left off.', 'app')),
    event(tool('r2')),
    event({ kind: 'text-delta', streamId: 'm2', text: 'Reading the grid', ...lead }),
  ]);

  it('numbers turns from the user message to the turn end, as the turn strip does, and leaves the live one open', () => {
    const groups = groupTurns(rows);
    expect(groups.map((group) => [group.index, group.finished, group.rows.map((row) => row.type)])).toEqual([
      [null, true, ['system']],
      [1, true, ['user', 'tool', 'prose', 'turn-end']],
      // The app's own message starts nothing: the next tool does, and it sits in the turn.
      [2, false, ['user', 'tool', 'streaming']],
    ]);
  });

  it('keeps a queued user message inside the turn it arrives in, and ends a turn on a failed row too', () => {
    const groups = groupTurns(
      outputRows([
        event(user('First')),
        event(tool('a')),
        event(user('Also this')),
        event({ kind: 'result', subtype: 'error_max_turns', isError: true, durationMs: 1, numTurns: 1, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, ...lead }),
        event(tool('b')),
        event(result()),
      ]),
    );
    expect(groups.map((group) => [group.index, group.rows.map((row) => row.type)])).toEqual([
      [1, ['user', 'tool', 'user', 'failed']],
      [2, ['tool', 'turn-end']],
    ]);
  });

  it('draws a header per turn, with rows under the open ones only; the live turn is always open', () => {
    const groups = groupTurns(rows);
    const collapsed = displayRows(groups, new Set());
    expect(collapsed.map((row) => row.type)).toEqual(['system', 'turn-header', 'turn-header', 'user', 'tool', 'streaming']);
    expect(collapsed[1]).toMatchObject({ key: 'turn:1', index: 1, live: false, expanded: false, rowCount: 4 });
    expect(collapsed[2]).toMatchObject({ key: 'turn:2', index: 2, live: true, expanded: true });

    const opened = displayRows(groups, new Set([turnRowKey(1)]));
    expect(opened.map((row) => row.type)).toEqual(['system', 'turn-header', 'user', 'tool', 'prose', 'turn-end', 'turn-header', 'user', 'tool', 'streaming']);
    expect(opened[1]).toMatchObject({ expanded: true });
  });
});

describe('live text over the skeleton rows', () => {
  const textDelta = (streamId: string, text: string, parentToolUseId: string | null = null) => event({ kind: 'text-delta', streamId, text, parentToolUseId });
  const thinkingDelta = (streamId: string, text: string, parentToolUseId: string | null = null) => event({ kind: 'thinking-delta', streamId, text, parentToolUseId });
  const finishedText = (streamId: string, text: string, parentToolUseId: string | null = null) => event({ kind: 'text', streamId, text, parentToolUseId });
  const finishedThinking = (streamId: string, text: string) => event({ kind: 'thinking', streamId, text, ...lead });

  /** What the stream draws: the skeleton's rows with the live text over them. */
  function drawn(events: ReturnType<typeof event>[]) {
    const store = createAgentOutputStore();
    store.watch('71273');
    store.receive(events);
    const output = store.getState().byTicket.get('71273')!;
    return { rows: withLiveText(outputRows(output.skeleton), liveTexts(output.events)), events: output.events, skeleton: output.skeleton };
  }

  it('draws exactly the rows folding every event would, at each point of a stream', () => {
    const events = [
      event({ kind: 'system', text: 'Plan approved', ...lead }),
      thinkingDelta('th_1', 'Looking at '),
      thinkingDelta('th_1', 'the grid'),
      finishedThinking('th_1', 'Looking at the grid.'),
      textDelta('m_old', 'An interrupted '),
      event(tool('t1')),
      textDelta('m_old', 'thought'),
      event(tool('spawn_1', { tool: 'spawn', label: 'Spawn', detail: 'explore', stats: null })),
      textDelta('m_sub', 'Sub-agent ', 'spawn_1'),
      thinkingDelta('th_sub', 'Sub thinks', 'spawn_1'),
      textDelta('m_sub', 'reading', 'spawn_1'),
      textDelta('m_1', 'Wiring '),
      textDelta('m_1', 'the filters'),
      finishedText('m_1', 'Wiring the filters.'),
      textDelta('m_2', 'Now '),
      thinkingDelta('th_2', 'Hmm'),
      textDelta('m_2', 'testing'),
      thinkingDelta('th_2', ' more'),
      // A stream id used again after its block finished is a new stream with its own row.
      thinkingDelta('th_re', 'a'),
      finishedThinking('th_re', 'A'),
      event(tool('t2')),
      thinkingDelta('th_re', 'b'),
      thinkingDelta('th_re', 'c'),
    ];
    for (let count = 1; count <= events.length; count++) {
      const so_far = events.slice(0, count);
      expect(drawn(so_far).rows, `after ${count} events`).toEqual(outputRows(drawn(so_far).events));
    }
  });

  it('shows a stream id reused after its block finished as a second, live row', () => {
    const { rows } = drawn([thinkingDelta('th_re', 'a'), finishedThinking('th_re', 'A'), event(tool('t2')), thinkingDelta('th_re', 'b'), thinkingDelta('th_re', 'c')]);
    expect(rows.map((row) => row.type)).toEqual(['thinking', 'tool', 'thinking']);
    expect(rows[0]).toMatchObject({ text: 'A', live: false });
    expect(rows[2]).toMatchObject({ text: 'bc', live: true });
  });

  it('keeps every row but the one being written, and the list itself when nothing changed', () => {
    const store = createAgentOutputStore();
    store.watch('71273');
    store.receive([event(tool('t1')), event({ kind: 'text', streamId: 'm_0', text: 'Done.', ...lead }), textDelta('m_2', 'Wir')]);
    const before = store.getState().byTicket.get('71273')!;
    const baseRows = outputRows(before.skeleton);
    const rows = withLiveText(baseRows, liveTexts(before.events));

    store.receive([textDelta('m_2', 'ing the grid')]);
    const after = store.getState().byTicket.get('71273')!;
    // Nothing structural changed, so the rows the stream folds are the same list.
    expect(after.skeleton).toBe(before.skeleton);
    const next = withLiveText(baseRows, liveTexts(after.events));
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toBe(rows[1]);
    expect(next[2]).toMatchObject({ type: 'streaming', text: 'Wiring the grid', live: true });
    expect(next[2]).not.toBe(rows[2]);
    expect(withLiveText(baseRows, new Map())).toBe(baseRows);
  });

  it('leaves a finished block’s text alone, and shows an unfinished older stream in full', () => {
    const { rows } = drawn([thinkingDelta('th_1', 'a'), thinkingDelta('th_1', 'b'), finishedThinking('th_1', 'The final thought.'), textDelta('m_1', 'Half '), event(tool('t1')), textDelta('m_1', 'done')]);
    expect(rows[0]).toMatchObject({ type: 'thinking', text: 'The final thought.', live: false });
    expect(rows[1]).toMatchObject({ type: 'streaming', text: 'Half done', live: false });
  });

  it('brings a sub-agent’s streaming line up to date on its Spawn row, with the latest line', () => {
    const { rows } = drawn([event(tool('spawn_1', { tool: 'spawn', label: 'Spawn', detail: 'explore', stats: null, toolUseIds: ['spawn_1'] })), textDelta('m_sub', 'Found ', 'spawn_1'), textDelta('m_sub', 'four forms', 'spawn_1')]);
    const spawn = rows[0] as Extract<OutputRow, { type: 'tool' }>;
    expect(spawn.subagents[0]!.rows[0]).toMatchObject({ type: 'streaming', text: 'Found four forms' });
    expect(spawn.subagents[0]!.latest).toBe('Found four forms');
  });

  it('puts the live text over grouped rows too, header rows untouched', () => {
    const { rows } = drawn([event({ kind: 'user', messageId: null, text: 'go', priority: null, source: 'composer', ...lead }), textDelta('m_1', 'Wor'), textDelta('m_1', 'king')]);
    const shown = withLiveText(displayRows(groupTurns(rows as OutputRow[]), new Set()), liveTexts([textDelta('m_1', 'Working now')]));
    expect(shown.map((row) => row.type)).toEqual(['turn-header', 'user', 'streaming']);
    expect(shown[2]).toMatchObject({ text: 'Working now' });
  });
});
