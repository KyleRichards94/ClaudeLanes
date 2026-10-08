import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultStageGates } from '@agent-lanes/contracts';
import { adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { agentTickets } from '@/entities/agent-ticket';
import { GateActions } from '@/features/resolve-gate';
import { resetTicketPageTabs } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { TicketPage } from './TicketPage';

vi.setConfig({ testTimeout: 30_000 });

const record = fakeTicketRecord({
  stageHistory: [
    { stage: 'queued', at: 1_000 },
    { stage: 'planning', at: 2_000 },
  ],
});

let bridge: FakeBridge;

/** The drill-in and the same ticket's board card controls, side by side under one query client. */
function renderBoth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createRouter(routes.ticket(record.id))}>
        <GateActions ticketId={record.id} placement="card" />
        <TicketPage ticketId={record.id} />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

const cardGate = () => screen.queryByTestId(`gate-card-${record.id}`);
const stepperGate = () => screen.queryByTestId(`gate-stepper-${record.id}`);

describe('stage stepper gates (AL-171)', () => {
  beforeEach(() => {
    agentTickets.load([record]);
    resetTicketPageTabs();
    bridge = installFakeBridge({
      'tickets:get': { ok: true, data: { record } },
      'ado:getWorkItem': { ok: true, data: adoFixtureWorkItem(71273) },
      'agent:resolveGate': { ok: true, data: { resolved: true } },
      'agent:setGate': { ok: true, data: { gates: { ...defaultStageGates(), qa: 'approval' }, released: false } },
    });
  });

  it('shows Approve and Request changes on the waiting step, and approving there clears the card too', async () => {
    renderBoth();
    await screen.findByTestId('stage-stepper');
    expect(cardGate()).toBeNull();
    expect(stepperGate()).toBeNull();

    act(() => agentTickets.openGate(record.id, 'planning', 3_000));
    expect(cardGate()).toBeTruthy();
    expect(stepperGate()?.textContent).toContain('Waiting for you · approve plan');
    expect(screen.getByTestId('stage-step-planning').getAttribute('aria-label')).toMatch(/waiting for approval$/);

    fireEvent.click(screen.getByTestId(`gate-stepper-${record.id}-approve`));
    await waitFor(() => expect(stepperGate()).toBeNull());
    expect(cardGate()).toBeNull();
    expect(bridge.invoke).toHaveBeenCalledWith('agent:resolveGate', { ticketId: record.id, decision: 'approve' });
  });

  it('approving on the card is the same action and clears the stepper', async () => {
    renderBoth();
    await screen.findByTestId('stage-stepper');
    act(() => agentTickets.openGate(record.id, 'planning', 3_000));

    fireEvent.click(screen.getByTestId(`gate-card-${record.id}-approve`));
    await waitFor(() => expect(cardGate()).toBeNull());
    expect(stepperGate()).toBeNull();
    expect(bridge.invoke).toHaveBeenCalledWith('agent:resolveGate', { ticketId: record.id, decision: 'approve' });
  });

  it('a decision made elsewhere (agent:gate) clears both', async () => {
    renderBoth();
    await screen.findByTestId('stage-stepper');
    act(() => agentTickets.openGate(record.id, 'planning', 3_000));
    act(() => agentTickets.resolveGate(record.id));
    expect(cardGate()).toBeNull();
    expect(stepperGate()).toBeNull();
  });

  it('asks for a note before sending Request changes', async () => {
    renderBoth();
    await screen.findByTestId('stage-stepper');
    act(() => agentTickets.openGate(record.id, 'planning', 3_000));

    fireEvent.click(screen.getByTestId(`gate-stepper-${record.id}-changes`));
    fireEvent.click(screen.getByTestId(`gate-stepper-${record.id}-send`));
    expect(screen.getByText('Say what the agent should change.')).toBeTruthy();
    expect(bridge.invoke).not.toHaveBeenCalledWith('agent:resolveGate', expect.anything());

    fireEvent.change(screen.getByRole('textbox', { name: 'What should change?' }), { target: { value: 'Keep frmJobNotes in WinForms' } });
    fireEvent.click(screen.getByTestId(`gate-stepper-${record.id}-send`));
    await waitFor(() => expect(stepperGate()).toBeNull());
    expect(bridge.invoke).toHaveBeenCalledWith('agent:resolveGate', {
      ticketId: record.id,
      decision: 'request-changes',
      note: 'Keep frmJobNotes in WinForms',
    });
  });

  it('toggles a stage gate per step and keeps the store in step with main', async () => {
    renderBoth();
    await screen.findByTestId('stage-stepper');
    const qa = screen.getByTestId('stage-gate-qa');
    expect(qa.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('stage-gate-planning').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(qa);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:setGate', { ticketId: record.id, stage: 'qa', gate: 'approval' }));
    await waitFor(() => expect(screen.getByTestId('stage-gate-qa').getAttribute('aria-checked')).toBe('true'));
    expect(agentTickets.getState().byId.get(record.id)?.gates.qa).toBe('approval');
  });
});
