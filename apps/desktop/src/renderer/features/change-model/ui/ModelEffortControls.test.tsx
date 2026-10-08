import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentModelState } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentTicketEventHandlers, createAgentTicketStore, useAgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { clearToasts, getToasts } from '@/shared/model';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { modelControls } from '../model/controls';
import { ModelEffortControls } from './ModelEffortControls';

function Harness({ store }: { store: AgentTicketStore }) {
  const ticket = useAgentTicket('71273', store);
  return ticket ? <ModelEffortControls ticket={ticket} store={store} /> : null;
}

function state(fields: Partial<AgentModelState>): AgentModelState {
  return { ticketId: '71273', model: 'opus', effort: 'xhigh', pending: null, ...fields };
}

function setup(replies: Parameters<typeof installFakeBridge>[0] = {}, record = fakeTicketRecord({ id: '71273', model: 'opus', effort: 'xhigh' })) {
  const bridge = installFakeBridge(replies);
  const store = createAgentTicketStore();
  store.load([record]);
  const handlers = createAgentTicketEventHandlers(store);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness store={store} />
    </QueryClientProvider>,
  );
  return { bridge, handlers, store };
}

const radio = (name: string) => screen.getByRole('radio', { name });

afterEach(() => clearToasts());

describe('ModelEffortControls (AL-172)', () => {
  it('shows the running model on the track and the effort as pills', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Model' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Effort' })).toBeTruthy();
    expect(radio('Opus').getAttribute('aria-checked')).toBe('true');
    expect(radio('Extra high effort').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('agent-switching')).toBeNull();
  });

  it('a model change shows "switching" until main reports it applied', async () => {
    const { bridge, handlers } = setup({ 'agent:setModel': { ok: true, data: state({ pending: { model: 'sonnet', effort: 'xhigh' } }) } });

    fireEvent.click(radio('Sonnet'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:setModel', { ticketId: '71273', model: 'sonnet' }));
    expect(radio('Sonnet').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('agent-switching').textContent).toContain('Switching · next turn');
    expect(screen.getByText('Opus → Sonnet · XHigh')).toBeTruthy();

    // The next turn starts on Sonnet (AL-106's `agent:model` event).
    act(() => handlers['agent:model']?.({ ...state({ model: 'sonnet' }), at: 2 }));
    expect(screen.queryByTestId('agent-switching')).toBeNull();
    expect(radio('Sonnet').getAttribute('aria-checked')).toBe('true');
  });

  it('an effort change reads "Opus · XHigh → High" while it waits', async () => {
    const { bridge } = setup({ 'agent:setEffort': { ok: true, data: state({ pending: { model: 'opus', effort: 'high' } }) } });
    fireEvent.click(radio('High effort'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:setEffort', { ticketId: '71273', effort: 'high' }));
    expect(screen.getByText('Opus · XHigh → High')).toBeTruthy();
  });

  it('a ticket without a live session applies the change at once', async () => {
    setup({ 'agent:setModel': { ok: true, data: state({ model: 'haiku' }) } });
    fireEvent.click(radio('Haiku'));
    await waitFor(() => expect(radio('Haiku').getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(screen.queryByTestId('agent-switching')).toBeNull());
  });

  it('a refused change puts the switchers back and raises a toast', async () => {
    setup({ 'agent:setModel': { ok: false, code: 'INTERNAL', message: 'The model could not be switched: boom' } });
    fireEvent.click(radio('Sonnet'));
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0]).toMatchObject({ tone: 'error', title: "Couldn't switch the model" });
    expect(radio('Opus').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('agent-switching')).toBeNull();
  });

  it('switches off on a done ticket and says why', () => {
    setup({}, fakeTicketRecord({ id: '71273', stage: 'done' }));
    expect(screen.getByRole('radiogroup', { name: 'Model' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('The ticket is done; there is no agent to switch.')).toBeTruthy();
  });
});

describe('modelControls (AL-172)', () => {
  const base = { id: '1', model: 'opus', effort: 'high', stage: 'implementing', switching: null } as const;

  it('shows the pending switch on the segments', () => {
    expect(modelControls({ ...base, switching: { model: 'sonnet', effort: 'high', requestedAt: 1 } })).toMatchObject({
      model: 'sonnet',
      effort: 'high',
      switchingLine: 'Opus → Sonnet · High',
      disabledReason: null,
    });
  });

  it('has no switching line when nothing waits', () => {
    expect(modelControls(base).switchingLine).toBeNull();
  });
});
