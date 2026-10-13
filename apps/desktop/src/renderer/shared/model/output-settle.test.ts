import type { AgentOutputEvent, AgentOutputItem } from '@agent-lanes/contracts';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { noteOutputEvents, resetOutputSettle, useOutputSettle, useTurnsSettled } from './output-settle';

let seq = 0;
const event = (ticketId: string, item: Partial<AgentOutputItem> & { kind: AgentOutputItem['kind'] }): AgentOutputEvent => ({
  ticketId,
  at: 1,
  seq: (seq += 1),
  item: { parentToolUseId: null, ...item } as AgentOutputItem,
});
const tool = (ticketId: string, rowId: string, kind: 'edit' | 'write' | 'bash' | 'read') =>
  event(ticketId, { kind: 'tool', rowId, toolUseIds: [rowId], tool: kind, label: kind, detail: 'x', stats: null });
const done = (ticketId: string, rowId: string, isError = false) =>
  event(ticketId, { kind: 'tool-result', rowId, toolUseId: rowId, isError, summary: '', stats: null });
const turnEnd = (ticketId: string) =>
  event(ticketId, { kind: 'result', subtype: 'success', isError: false, durationMs: 1, numTurns: 1, costUsd: 0.1, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });

describe('output settle counters (AL-276, AL-277)', () => {
  beforeEach(() => resetOutputSettle());

  it('counts finished Edit, Write and Bash calls and turn ends, per ticket, and ignores Read', () => {
    const { result } = renderHook(() => useOutputSettle('71273'));
    expect(result.current).toEqual({ files: 0, turns: 0 });

    act(() => noteOutputEvents([tool('71273', 'a', 'edit'), done('71273', 'a'), tool('71273', 'r', 'read'), done('71273', 'r')]));
    expect(result.current).toEqual({ files: 1, turns: 0 });

    act(() => noteOutputEvents([tool('71273', 'b', 'bash'), done('71273', 'b', true), tool('71273', 'w', 'write'), done('71273', 'w', true)]));
    // A failed Bash may still have changed files; a failed Write did not.
    expect(result.current).toEqual({ files: 2, turns: 0 });

    act(() => noteOutputEvents([turnEnd('71273'), done('71330', 'zzz')]));
    expect(result.current).toEqual({ files: 3, turns: 1 });
  });

  it('adds the turns of several tickets', () => {
    const { result } = renderHook(() => useTurnsSettled(['71273', 'comp']));
    act(() => noteOutputEvents([turnEnd('71273'), turnEnd('comp'), turnEnd('other')]));
    expect(result.current).toBe(2);
  });
});
