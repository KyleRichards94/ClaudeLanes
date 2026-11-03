import { act, render, screen } from '@testing-library/react';
import type { AgentOutputEvent, AgentTranscript } from '@agent-lanes/contracts';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { fakeOutputEvent, installFakeBridge } from '@/shared/testing';
import { openTicketOutput } from './backfill';
import { createAgentOutputEventHandlers } from './event-handlers';
import { useAgentOutput, useAgentOutputSkeleton } from './hooks';
import { createAgentOutputStore, mergeOutput, selectTicketOutput, selectTicketSkeleton } from './store';

function texts(events: readonly AgentOutputEvent[]): string[] {
  return events.map((event) => (event.item.kind === 'text' || event.item.kind === 'text-delta' || event.item.kind === 'system' ? event.item.text : event.item.kind));
}

/** An invoke reply the test settles when it chooses, like main answering while output keeps streaming. */
function deferredTranscript() {
  let settle!: (transcript: AgentTranscript) => void;
  const reply = new Promise<unknown>((resolve) => {
    settle = (transcript) => resolve({ ok: true, data: transcript });
  });
  return { reply, settle };
}

describe('agent output store (AL-102)', () => {
  it('a drill-in opened mid-run shows prior output, then continues live with no gap or duplicate', async () => {
    const store = createAgentOutputStore();
    const handlers = createAgentOutputEventHandlers(store);
    const bridge = installFakeBridge();
    const pending = deferredTranscript();
    vi.mocked(bridge.invoke).mockImplementation(() => pending.reply);

    // Main has already streamed seq 1–4 when the drill-in opens.
    const opening = openTicketOutput('71273', store);
    expect(bridge.invoke).toHaveBeenCalledWith('agent:getTranscript', { ticketId: '71273' });

    // Seq 4 was in flight to the renderer as well as in main's buffer; 5 arrives before main answers.
    handlers['agent:output']?.([fakeOutputEvent('71273', 4), fakeOutputEvent('71273', 5), fakeOutputEvent('71288', 1)]);
    pending.settle({ ticketId: '71273', lastSeq: 5, events: [1, 2, 3, 4, 5].map((seq) => fakeOutputEvent('71273', seq)) });
    await expect(opening).resolves.toBe(true);

    handlers['agent:output']?.([fakeOutputEvent('71273', 6)]);

    const shown = selectTicketOutput(store.getState(), '71273');
    expect(shown.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(texts(shown)).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6']);
    // A ticket nobody watches is not kept.
    expect(store.getState().byTicket.has('71288')).toBe(false);
    expect(store.getState().byTicket.get('71273')?.backfilled).toBe(true);
  });

  it('keeps history from before a restart (seq ≤ 0) ahead of live output', () => {
    const store = createAgentOutputStore();
    store.watch('71273');
    store.receive([fakeOutputEvent('71273', 1)]);
    store.backfill({ ticketId: '71273', lastSeq: 1, events: [fakeOutputEvent('71273', 0, { seq: -1 }), fakeOutputEvent('71273', 0, { seq: 0 }), fakeOutputEvent('71273', 1)] });
    expect(selectTicketOutput(store.getState(), '71273').map((event) => event.seq)).toEqual([-1, 0, 1]);
  });

  it('drops streamed deltas once their finished text has arrived', () => {
    const store = createAgentOutputStore();
    store.watch('71273');
    const delta = (seq: number, text: string) => fakeOutputEvent('71273', seq, { item: { kind: 'text-delta', streamId: 'msg_9', text, parentToolUseId: null } });
    store.receive([delta(1, 'Wiring the job grid'), delta(2, ' filters')]);
    expect(texts(selectTicketOutput(store.getState(), '71273'))).toEqual(['Wiring the job grid', ' filters']);

    store.receive([fakeOutputEvent('71273', 3, { item: { kind: 'text', streamId: 'msg_9', text: 'Wiring the job grid filters', parentToolUseId: null } })]);
    expect(texts(selectTicketOutput(store.getState(), '71273'))).toEqual(['Wiring the job grid filters']);
  });

  it('keeps the newest events up to its capacity', () => {
    expect(mergeOutput([1, 2, 3].map((seq) => fakeOutputEvent('a', seq)), [4, 5].map((seq) => fakeOutputEvent('a', seq)), 4).map((e) => e.seq)).toEqual([2, 3, 4, 5]);
    expect(mergeOutput([3, 5].map((seq) => fakeOutputEvent('a', seq)), [4, 5].map((seq) => fakeOutputEvent('a', seq))).map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('watches a ticket once, and still shows live output when main cannot answer', async () => {
    const store = createAgentOutputStore();
    const bridge = installFakeBridge();
    await expect(openTicketOutput('71273', store)).resolves.toBe(false);
    await expect(openTicketOutput('71273', store)).resolves.toBe(true);
    expect(bridge.invoke).toHaveBeenCalledOnce();
    store.receive([fakeOutputEvent('71273', 1)]);
    expect(selectTicketOutput(store.getState(), '71273')).toHaveLength(1);
    store.forget('71273');
    expect(selectTicketOutput(store.getState(), '71273')).toEqual([]);
  });

  it('useAgentOutput backfills and re-renders with live output', async () => {
    const store = createAgentOutputStore();
    installFakeBridge({ 'agent:getTranscript': { ok: true, data: { ticketId: '71273', lastSeq: 2, events: [fakeOutputEvent('71273', 1), fakeOutputEvent('71273', 2)] } } });
    function Output() {
      const events = useAgentOutput('71273', store);
      return <Text testID="output">{texts(events).join(' | ')}</Text>;
    }
    render(<Output />);
    expect(await screen.findByText('line 1 | line 2')).toBeTruthy();
    act(() => store.receive([fakeOutputEvent('71273', 3)]));
    expect(screen.getByTestId('output').textContent).toBe('line 1 | line 2 | line 3');
  });
});

describe('output skeleton', () => {
  const textDelta = (seq: number, text: string, streamId = 'msg_9', parent: string | null = null) =>
    fakeOutputEvent('71273', seq, { item: { kind: 'text-delta', streamId, text, parentToolUseId: parent } });
  const thinkingDelta = (seq: number, text: string, streamId = 'th_1') =>
    fakeOutputEvent('71273', seq, { item: { kind: 'thinking-delta', streamId, text, parentToolUseId: null } });
  const finished = (seq: number, streamId = 'msg_9') => fakeOutputEvent('71273', seq, { item: { kind: 'text', streamId, text: 'done', parentToolUseId: null } });
  const tool = (seq: number) =>
    fakeOutputEvent('71273', seq, { item: { kind: 'tool', rowId: `r${seq}`, toolUseIds: [`r${seq}`], tool: 'read', label: 'Read', detail: 'a.cs', stats: null, parentToolUseId: null } });
  const skeletonOf = (store: ReturnType<typeof createAgentOutputStore>) => selectTicketSkeleton(store.getState(), '71273');

  function watched() {
    const store = createAgentOutputStore();
    store.watch('71273');
    return store;
  }

  it('keeps its identity while a stream’s deltas arrive, so nothing derived from it re-derives', () => {
    const store = watched();
    store.receive([tool(1), textDelta(2, 'Wiring')]);
    const before = skeletonOf(store);
    expect(before.map((event) => event.seq)).toEqual([1, 2]);

    store.receive([textDelta(3, ' the grid')]);
    store.receive([textDelta(4, ' filters'), thinkingDelta(5, 'hm')]);
    store.receive([textDelta(6, '.')]);

    // The thinking stream's first delta is structural (a new row), the rest are not.
    const after = skeletonOf(store);
    expect(after).not.toBe(before);
    expect(after.map((event) => event.seq)).toEqual([1, 2, 5]);
    store.receive([thinkingDelta(7, ' more'), textDelta(8, ' text')]);
    expect(skeletonOf(store)).toBe(after);
    // The full list still has every delta, for the row being written.
    expect(selectTicketOutput(store.getState(), '71273')).toHaveLength(8);
  });

  it('changes on a structural event, and drops a text stream’s first delta once its finished text arrives', () => {
    const store = watched();
    store.receive([textDelta(1, 'a'), textDelta(2, 'b')]);
    const streaming = skeletonOf(store);
    store.receive([tool(3)]);
    expect(skeletonOf(store)).not.toBe(streaming);
    expect(skeletonOf(store).map((event) => event.seq)).toEqual([1, 3]);

    store.receive([finished(4)]);
    expect(skeletonOf(store).map((event) => event.seq)).toEqual([3, 4]);
  });

  it('keeps a sub-agent’s stream apart from the lead’s with the same id, and thinking apart from text', () => {
    const store = watched();
    store.receive([textDelta(1, 'a'), textDelta(2, 'b', 'msg_9', 'toolu_x'), thinkingDelta(3, 'c', 'msg_9'), textDelta(4, 'd'), textDelta(5, 'e', 'msg_9', 'toolu_x')]);
    expect(skeletonOf(store).map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('opens a new stream when a stream id is used again after its thinking block finished', () => {
    const store = watched();
    const finishedThinking = (seq: number) => fakeOutputEvent('71273', seq, { item: { kind: 'thinking', streamId: 'th_1', text: 'A', parentToolUseId: null } });
    store.receive([thinkingDelta(1, 'a'), thinkingDelta(2, 'a2'), finishedThinking(3), tool(4), thinkingDelta(5, 'b')]);
    expect(skeletonOf(store).map((event) => event.seq)).toEqual([1, 3, 4, 5]);
    const before = skeletonOf(store);
    store.receive([thinkingDelta(6, 'c')]);
    expect(skeletonOf(store)).toBe(before);
  });

  it('is rebuilt when out-of-order events or a backfill change what comes first', () => {
    const store = watched();
    store.receive([textDelta(5, 'late')]);
    store.receive([textDelta(4, 'early')]);
    // The earlier delta is now the stream's first.
    expect(skeletonOf(store).map((event) => event.seq)).toEqual([4]);

    store.backfill({ ticketId: '71273', lastSeq: 5, events: [tool(1), textDelta(3, 'oldest')] });
    expect(skeletonOf(store).map((event) => event.seq)).toEqual([1, 3]);
  });

  it('is the same list as the events when there are no deltas, and empty for a ticket nobody watches', () => {
    const store = watched();
    store.receive([tool(1), finished(2)]);
    expect(skeletonOf(store)).toEqual(selectTicketOutput(store.getState(), '71273'));
    expect(selectTicketSkeleton(store.getState(), '99999')).toEqual([]);
  });

  it('useAgentOutputSkeleton re-renders for structural events only', async () => {
    const store = createAgentOutputStore();
    installFakeBridge({ 'agent:getTranscript': { ok: true, data: { ticketId: '71273', lastSeq: 0, events: [] } } });
    const renders = vi.fn();
    function Skeleton() {
      const events = useAgentOutputSkeleton('71273', store);
      renders(events.length);
      return <Text testID="skeleton">{events.length}</Text>;
    }
    render(<Skeleton />);
    await act(async () => undefined);
    act(() => store.receive([textDelta(1, 'a')]));
    const settled = renders.mock.calls.length;
    act(() => store.receive([textDelta(2, 'b')]));
    act(() => store.receive([textDelta(3, 'c')]));
    expect(renders).toHaveBeenCalledTimes(settled);

    act(() => store.receive([tool(4)]));
    expect(screen.getByTestId('skeleton').textContent).toBe('2');
  });
});
