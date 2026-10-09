import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionState, AgentSessionStatus } from '@agent-lanes/contracts';
import { adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { agentTickets } from '@/entities/agent-ticket';
import { resetTicketPageTabs } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { SESSION_PILL_STATES } from './TicketHeader';
import { TicketPage } from './TicketPage';

vi.setConfig({ testTimeout: 30_000 });

const SESSION = '9ad804aa-34ce-429e-8743-dcfb8cad787a';
const status = (state: AgentSessionState, message: string | null = null): AgentSessionStatus => ({ ticketId: '71273', state, sessionId: SESSION, message });

function renderPage(bridge: FakeBridge) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createRouter(routes.ticket('71273'))}>
        <TicketPage ticketId="71273" />
      </RouterProvider>
    </QueryClientProvider>,
  );
  return bridge;
}

function bridgeWith(state: AgentSessionState, message: string | null = null) {
  return installFakeBridge({
    'tickets:get': { ok: true, data: { record: fakeTicketRecord({ sessionId: SESSION }) } },
    'ado:getWorkItem': { ok: true, data: adoFixtureWorkItem(71273) },
    'agent:getStatus': { ok: true, data: status(state, message) },
    'agent:reconnect': { ok: true, data: status('idle') },
  });
}

describe('session status pill (AL-252)', () => {
  beforeEach(() => {
    agentTickets.load([]);
    resetTicketPageTabs();
  });

  it('has a tone and a word for every session state', () => {
    for (const state of ['none', 'starting', 'running', 'idle', 'paused', 'queued', 'stopped', 'lost'] as const) {
      expect(SESSION_PILL_STATES[state].tone).toBeTruthy();
    }
    expect(SESSION_PILL_STATES.running).toEqual({ tone: 'ok', word: 'running' });
    expect(SESSION_PILL_STATES.lost).toEqual({ tone: 'danger', word: 'lost' });
    expect(SESSION_PILL_STATES.stopped).toEqual({ tone: 'neutral', word: 'ended' });
  });

  it('shows the short id and the state, with the full id in the tooltip', async () => {
    renderPage(bridgeWith('running'));
    const pill = await screen.findByTestId('session-pill');
    await waitFor(() => expect(pill.textContent).toMatch(/^Session 9ad804aa · running/));
    fireEvent.focus(screen.getByTestId('session-pill-anchor'));
    expect((await screen.findByRole('tooltip')).textContent).toContain(`Session ${SESSION}`);
    expect(screen.queryByTestId('session-reconnect')).toBeNull();
  });

  it('offers Reconnect on a lost session, with the reason in the tooltip', async () => {
    const bridge = renderPage(bridgeWith('lost', 'The Claude Code session ended unexpectedly.'));
    const pill = await screen.findByTestId('session-pill');
    await waitFor(() => expect(pill.textContent).toMatch(/· lost/));
    fireEvent.focus(screen.getByTestId('session-pill-anchor'));
    expect((await screen.findByRole('tooltip')).textContent).toContain('ended unexpectedly');
    fireEvent.click(screen.getByTestId('session-reconnect'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:reconnect', { ticketId: '71273' }));
    await waitFor(() => expect(screen.getByTestId('session-pill').textContent).toMatch(/· idle/));
  });

  it('offers Reconnect on a session the user ended', async () => {
    renderPage(bridgeWith('stopped', 'You ended this session.'));
    await waitFor(() => expect(screen.getByTestId('session-pill').textContent).toMatch(/· ended/));
    expect(screen.getByTestId('session-reconnect')).toBeTruthy();
  });
});
