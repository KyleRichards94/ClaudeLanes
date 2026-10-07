import { act, render, screen } from '@testing-library/react';
import type { AgentOutputEvent, AgentTranscript } from '@agent-lanes/contracts';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { fakeOutputEvent, installFakeBridge } from '@/shared/testing';
import { openTicketOutput } from './backfill';
import { createAgentOutputEventHandlers } from './event-handlers';
import { useAgentOutput } from './hooks';
import { createAgentOutputStore, mergeOutput, selectTicketOutput } from './store';

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
