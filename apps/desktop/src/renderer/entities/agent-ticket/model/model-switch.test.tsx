import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AgentModelEvent } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { useApplyModelNow, useSetAgentEffort, useSetAgentModel } from '../api/model';
import { cardView } from '../ui/card-view';
import { createAgentTicketEventHandlers } from './event-handlers';
import { selectTicket } from './selectors';
import { createAgentTicketStore } from './store';

/** AL-106: the card's "switching" state from `agent:model` events and the model/effort mutations. */

function setup() {
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273', model: 'opus', effort: 'high' })]);
  return { store, handlers: createAgentTicketEventHandlers(store) };
}

function modelEvent(fields: Partial<AgentModelEvent>): AgentModelEvent {
  return { ticketId: '71273', at: 5_000, model: 'opus', effort: 'high', pending: null, ...fields };
}

function card(store: ReturnType<typeof createAgentTicketStore>) {
  const ticket = selectTicket(store.getState(), '71273');
  if (!ticket) throw new Error('no ticket');
  return cardView(ticket);
}

describe('model switching on the card (AL-106)', () => {
  it('Opus → Sonnet mid-run shows "Opus → Sonnet · High" then clears when applied', () => {
    const { store, handlers } = setup();
    expect(card(store).modelLine).toBe('Opus · High');

    handlers['agent:model']?.(modelEvent({ pending: { model: 'sonnet', effort: 'high' } }));
    expect(card(store)).toMatchObject({ state: 'switching', modelLine: 'Opus → Sonnet · High', footer: { label: 'Switching · applies next turn' } });

    handlers['agent:model']?.(modelEvent({ model: 'sonnet', pending: null, at: 6_000 }));
    expect(card(store).modelLine).toBe('Sonnet · High');
    expect(card(store).footer).toBeNull();
    expect(card(store).state).not.toBe('switching');
  });

  it('switching back before it applied clears the pill', () => {
    const { store, handlers } = setup();
    handlers['agent:model']?.(modelEvent({ pending: { model: 'haiku', effort: 'high' } }));
    handlers['agent:model']?.(modelEvent({ pending: null }));
    expect(card(store)).toMatchObject({ modelLine: 'Opus · High', footer: null });
  });

  it('a renderer that missed events catches up with what runs and what is pending', () => {
    const { store, handlers } = setup();
    handlers['agent:model']?.(modelEvent({ model: 'sonnet', effort: 'low', pending: { model: 'sonnet', effort: 'max' } }));
    expect(card(store).modelLine).toBe('Sonnet · Low → Max');
  });
});

describe('model and effort mutations (AL-106)', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it('shows the switch at once, then what main says runs', async () => {
    const { store } = setup();
    const bridge = installFakeBridge({
      'agent:setModel': { ok: true, data: { ticketId: '71273', model: 'opus', effort: 'high', pending: { model: 'sonnet', effort: 'high' } } },
      'agent:setEffort': { ok: true, data: { ticketId: '71273', model: 'opus', effort: 'high', pending: { model: 'sonnet', effort: 'max' } } },
      'agent:applyModelNow': { ok: true, data: { ticketId: '71273', model: 'opus', effort: 'high', pending: { model: 'sonnet', effort: 'max' } } },
    });
    const model = renderHook(() => useSetAgentModel(store), { wrapper });
    const effort = renderHook(() => useSetAgentEffort(store), { wrapper });
    const now = renderHook(() => useApplyModelNow(store), { wrapper });

    await act(() => model.result.current.mutateAsync({ ticketId: '71273', model: 'sonnet' }));
    expect(bridge.invoke).toHaveBeenCalledWith('agent:setModel', { ticketId: '71273', model: 'sonnet' });
    expect(card(store).modelLine).toBe('Opus → Sonnet · High');

    await act(() => effort.result.current.mutateAsync({ ticketId: '71273', effort: 'max' }));
    expect(card(store).modelLine).toBe('Opus → Sonnet · Max');

    await act(() => now.result.current.mutateAsync({ ticketId: '71273' }));
    expect(bridge.invoke).toHaveBeenCalledWith('agent:applyModelNow', { ticketId: '71273' });
  });
});
