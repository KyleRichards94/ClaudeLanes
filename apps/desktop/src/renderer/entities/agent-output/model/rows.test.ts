import type { AgentOutputItem } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fakeOutputEvent } from '@/shared/testing';
import { outputRows, proseSpans, statSpans } from './rows';
import { estimateRowHeight, rowOffsets, windowFor } from './virtual';

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

  it("leaves sub-agents' output to the sub-agents tree and draws failed turns only", () => {
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    const rows = outputRows([
      event({ kind: 'text', streamId: 'msg_s', text: 'From razor-writer', parentToolUseId: 'toolu_spawn' }),
      event({ kind: 'result', subtype: 'success', isError: false, durationMs: 1, numTurns: 1, costUsd: 0, usage, ...lead }),
      event({ kind: 'result', subtype: 'error_max_turns', isError: true, durationMs: 1, numTurns: 1, costUsd: 0, usage, ...lead }),
      event({ kind: 'text', streamId: 'msg_e', text: '   ', ...lead }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ type: 'failed', text: 'Turn ended early · error max turns' })]);
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
  const rows = Array.from({ length: 10_000 }, (_, index) => ({ type: 'tool' as const, key: `t${index}`, tool: 'read' as const, label: 'Read', detail: `file ${index}`, stats: null, isError: false }));

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
});
