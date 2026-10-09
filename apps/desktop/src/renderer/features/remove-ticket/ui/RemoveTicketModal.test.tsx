import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { RemoveTicketModal } from './RemoveTicketModal';

const archived = { status: 'archived', archived: { archivedAt: 1, record: fakeTicketRecord(), deletedBranches: [], keptBranches: ['71273-cutover-frmjobcontrol-to'] } };

function renderModal(bridge: FakeBridge, onRemoved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RemoveTicketModal ticketId="71273" visible onClose={() => undefined} onRemoved={onRemoved} />
    </QueryClientProvider>,
  );
  return { bridge, onRemoved };
}

describe('Remove from board', () => {
  beforeEach(() => {
    agentTickets.load([fakeTicketRecord()]);
  });

  it('ends the session, archives the ticket and takes it off the board', async () => {
    const { bridge, onRemoved } = renderModal(
      installFakeBridge({
        'agent:stop': { ok: true, data: { stopped: true, status: { ticketId: '71273', state: 'stopped', sessionId: null, message: null } } },
        'tickets:archive': { ok: true, data: archived },
      }),
    );
    fireEvent.click(screen.getByTestId('remove-ticket-confirm'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tickets:archive', { ticketId: '71273', discardUnmerged: false, deleteMergedBranches: false, confirmed: true }));
    const order = (bridge.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([channel]) => channel);
    expect(order.indexOf('agent:stop')).toBeLessThan(order.indexOf('tickets:archive'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(agentTickets.getState().byId.has('71273')).toBe(false);
  });

  it('names unmerged work and asks again before discarding it', async () => {
    let attempts = 0;
    const bridge = installFakeBridge({ 'agent:stop': { ok: true, data: { stopped: false, status: { ticketId: '71273', state: 'none', sessionId: null, message: null } } } });
    (bridge.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel !== 'tickets:archive') return { ok: true, data: { stopped: false, status: { ticketId: '71273', state: 'none', sessionId: null, message: null } } };
      attempts += 1;
      if (!(payload as { discardUnmerged?: boolean }).discardUnmerged) {
        return { ok: false, code: 'VALIDATION', message: 'Unmerged work.', details: { reason: 'unmerged-work', branches: [{ branch: 'sub/71273-grid', commits: 2 }], dirtyWorktrees: ['C:/src/.agent-lanes/71273'] } };
      }
      return { ok: true, data: archived };
    });
    renderModal(bridge);
    fireEvent.click(screen.getByTestId('remove-ticket-confirm'));
    const unmerged = await screen.findByTestId('remove-ticket-unmerged');
    expect(unmerged.textContent).toContain('sub/71273-grid · 2 unmerged commits');
    expect(unmerged.textContent).toContain('C:/src/.agent-lanes/71273 · uncommitted changes');
    fireEvent.click(screen.getByTestId('remove-ticket-confirm-discard'));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(agentTickets.getState().byId.has('71273')).toBe(false));
  });
});
