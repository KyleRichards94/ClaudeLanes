import type { AgentOutputEvent, AgentOutputItem } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { RECENT_EDIT_MS, liveDiffSignal, recentEdits } from './live-diff';

let seq = 0;
function event(item: Partial<AgentOutputItem> & Pick<AgentOutputItem, 'kind'>, at = 1_000): AgentOutputEvent {
  seq += 1;
  return { ticketId: '71273', at, seq, item: { parentToolUseId: null, ...item } as AgentOutputItem };
}

const tool = (rowId: string, kind: 'edit' | 'write' | 'bash', detail: string) =>
  event({ kind: 'tool', rowId, toolUseIds: [rowId], tool: kind, label: kind, detail, stats: null });
const result = (rowId: string, isError = false, at = 1_000) => event({ kind: 'tool-result', rowId, toolUseId: rowId, isError, summary: '', stats: null }, at);

describe('the live diff (Output & diff)', () => {
  it('settles on every finished tool call and turn, and names the files Edit and Write changed', () => {
    const events = [
      tool('a', 'edit', 'src\\Grid.razor'),
      tool('b', 'bash', 'dotnet build'),
      result('a', false, 2_000),
      result('b', false, 2_500),
      tool('c', 'write', './src/New.cs'),
      result('c', true, 3_000),
    ];
    const signal = liveDiffSignal(events);
    expect(signal.settledSeq).toBe(events.at(-1)!.seq);
    // A failed Write changed nothing; paths are as git names them.
    expect(signal.edits).toEqual([{ path: 'src/Grid.razor', at: 2_000 }]);
  });

  it('keeps each file’s newest edit for a couple of minutes', () => {
    const edits = [
      { path: 'a.cs', at: 0 },
      { path: 'b.cs', at: 50_000 },
      { path: 'a.cs', at: 60_000 },
    ];
    expect(recentEdits(edits, 60_000 + RECENT_EDIT_MS)).toEqual(new Map([['a.cs', 60_000]]));
    expect(recentEdits(edits, 60_000)).toEqual(new Map([['a.cs', 60_000], ['b.cs', 50_000]]));
  });
});
