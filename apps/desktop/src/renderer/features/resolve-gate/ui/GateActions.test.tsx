import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentTicketStore, type AgentTicketStore } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { GateActions } from './GateActions';

/**
 * AL-220: the resolve-gate slice end to end in the renderer: the control, `useResolveGate` and the
 * agent ticket store, against the fake bridge. The drill-in's test covers the card and the stepper
 * clearing each other; this one covers Request changes and a decision main refuses.
 */

const record = fakeTicketRecord({ id: '71273', stage: 'planning' });
let bridge: FakeBridge;
let store: AgentTicketStore;

function renderGate() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <GateActions ticketId={record.id} placement="card" store={store} />
    </QueryClientProvider>,
  );
}

const gate = () => screen.queryByTestId(`gate-card-${record.id}`);

beforeEach(() => {
  store = createAgentTicketStore();
  store.load([record]);
  bridge = installFakeBridge({ 'agent:resolveGate': { ok: true, data: { resolved: true } } });
});

describe('resolve-gate (AL-104, AL-171, AL-220)', () => {
  it('shows nothing until a gate waits, then names it and shows what the agent asked to approve', () => {
    renderGate();
    expect(gate()).toBeNull();
    act(() => store.openGate(record.id, 'planning', 3_000, 'Plan ready: JobGrid.razor replaces frmJobControl'));
    expect(screen.getByRole('group', { name: /^Planning gate: / })).toBeTruthy();
    // The `set_stage` summary, so the user knows what they are approving (AL-254).
    expect(screen.getByTestId(`gate-card-${record.id}-summary`).textContent).toBe('Plan ready: JobGrid.razor replaces frmJobControl');
  });

  it('asks what to change before sending Request changes, and sends the note as the decision', async () => {
    renderGate();
    act(() => store.openGate(record.id, 'planning', 3_000));
    fireEvent.click(screen.getByTestId(`gate-card-${record.id}-changes`));
    fireEvent.click(screen.getByTestId(`gate-card-${record.id}-send`));
    expect(screen.getByText('Say what the agent should change.')).toBeTruthy();
    expect(bridge.invoke).not.toHaveBeenCalledWith('agent:resolveGate', expect.anything());

    fireEvent.change(screen.getByTestId(`gate-card-${record.id}-note`), { target: { value: '  Keep the old grid behind a flag.  ' } });
    fireEvent.click(screen.getByTestId(`gate-card-${record.id}-send`));
    await waitFor(() => expect(gate()).toBeNull());
    expect(bridge.invoke).toHaveBeenCalledWith('agent:resolveGate', { ticketId: record.id, decision: 'request-changes', note: 'Keep the old grid behind a flag.' });
  });

  it('keeps the gate open and says why when main refuses the decision', async () => {
    bridge = installFakeBridge({ 'agent:resolveGate': { ok: false, code: 'SESSION_LOST', message: 'The agent session ended.' } });
    renderGate();
    act(() => store.openGate(record.id, 'planning', 3_000));
    fireEvent.click(screen.getByTestId(`gate-card-${record.id}-approve`));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't send that: The agent session ended.");
    expect(gate()).toBeTruthy();
  });

  it('starts a new gate without the last one\'s note', async () => {
    renderGate();
    act(() => store.openGate(record.id, 'planning', 3_000));
    fireEvent.click(screen.getByTestId(`gate-card-${record.id}-changes`));
    fireEvent.change(screen.getByTestId(`gate-card-${record.id}-note`), { target: { value: 'Half a thought' } });
    act(() => store.openGate(record.id, 'code-review', 4_000));
    expect(screen.queryByTestId(`gate-card-${record.id}-note`)).toBeNull();
    expect(screen.getByRole('group', { name: /^Code review gate: / })).toBeTruthy();
  });
});
