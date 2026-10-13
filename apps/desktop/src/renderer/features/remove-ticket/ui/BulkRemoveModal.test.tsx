import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { BulkRemoveModal } from './BulkRemoveModal';

const IDS = ['71273', '71288', '71301'];

function archivedOf(ticketId: string) {
  return { ok: true, data: { status: 'archived', archived: { archivedAt: 1, record: fakeTicketRecord({ id: ticketId }), deletedBranches: [], keptBranches: [] } } };
}

/** 71288 has unmerged work until the second pass discards it. */
function bridgeWithOneHeld() {
  const bridge = installFakeBridge({});
  const archiveCalls: Array<{ ticketId: string; discardUnmerged: boolean }> = [];
  (bridge.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (channel: string, payload?: unknown) => {
    const { ticketId, discardUnmerged } = payload as { ticketId: string; discardUnmerged?: boolean };
    if (channel === 'agent:stop') return { ok: true, data: { stopped: true, status: { ticketId, state: 'stopped', sessionId: null, message: null } } };
    archiveCalls.push({ ticketId, discardUnmerged: discardUnmerged === true });
    if (ticketId === '71288' && !discardUnmerged) {
      return { ok: false, code: 'VALIDATION', message: 'Unmerged work.', details: { reason: 'unmerged-work', branches: [{ branch: '71288-job-grid-filters', commits: 3 }], dirtyWorktrees: [] } };
    }
    return archivedOf(ticketId);
  });
  return { bridge, archiveCalls };
}

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BulkRemoveModal laneName="Done" ticketIds={IDS} visible onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('Remove all from a lane', () => {
  beforeEach(() => {
    agentTickets.load(IDS.map((id) => fakeTicketRecord({ id, stage: 'done', stageHistory: [{ stage: 'done', at: 1 }] })));
  });

  it('removes every card, holds back the one with unmerged work, then removes it when asked', async () => {
    const { bridge, archiveCalls } = bridgeWithOneHeld();
    const onClose = renderModal();
    expect(screen.getByRole('dialog', { name: 'Remove all 3 tickets from Done?' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('bulk-remove-confirm'));
    const unmerged = await screen.findByTestId('bulk-remove-unmerged');
    expect(unmerged.textContent).toContain('71288-job-grid-filters · 3 unmerged commits');
    expect(archiveCalls).toEqual([
      { ticketId: '71273', discardUnmerged: false },
      { ticketId: '71288', discardUnmerged: false },
      { ticketId: '71301', discardUnmerged: false },
    ]);
    // Each session ends before its ticket is archived.
    const channels = (bridge.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([channel, payload]) => `${channel} ${(payload as { ticketId: string }).ticketId}`);
    expect(channels.indexOf('agent:stop 71273')).toBeLessThan(channels.indexOf('tickets:archive 71273'));
    expect(agentTickets.getState().byId.has('71273')).toBe(false);
    expect(agentTickets.getState().byId.has('71288')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('bulk-remove-confirm-discard'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(archiveCalls.at(-1)).toEqual({ ticketId: '71288', discardUnmerged: true });
    expect(agentTickets.getState().byId.has('71288')).toBe(false);
  });
});
