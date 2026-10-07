import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ArchivedTicket } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { IpcError, branchesQueryKey } from '@/shared/api';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { createAgentTicketStore } from '../model/store';
import { archivedTicketsQueryKey, useArchiveTicket, useArchivedTickets } from './archive';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const archived: ArchivedTicket = { archivedAt: 9_000, record: fakeTicketRecord({ stage: 'done' }), deletedBranches: [], keptBranches: ['71273-cutover-frmjobcontrol-to'] };

describe('archive', () => {
  it('takes the card off the board once archived and refreshes the archive list', async () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ stage: 'done' })]);
    const bridge = installFakeBridge({ 'tickets:archive': { ok: true, data: { status: 'archived', archived } } });
    const { client, wrapper } = setup();
    client.setQueryData(archivedTicketsQueryKey, []);
    client.setQueryData(branchesQueryKey('71273'), {});
    const { result } = renderHook(() => useArchiveTicket(store), { wrapper });

    await act(() => result.current.mutateAsync({ ticketId: '71273', deleteMergedBranches: true }));

    expect(bridge.invoke).toHaveBeenCalledWith('tickets:archive', { ticketId: '71273', deleteMergedBranches: true, confirmed: true });
    expect(store.getState().byId.has('71273')).toBe(false);
    expect(client.getQueryState(archivedTicketsQueryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(branchesQueryKey('71273'))).toBeUndefined();
  });

  it('keeps the card when only part of it could be removed', async () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ stage: 'done' })]);
    installFakeBridge({
      'tickets:archive': {
        ok: true,
        data: { status: 'partial', removedWorktrees: [], leftovers: [{ kind: 'worktree', target: 'C:\\src\\.agent-lanes\\71273', reason: 'EBUSY' }] },
      },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useArchiveTicket(store), { wrapper });

    await act(() => result.current.mutateAsync({ ticketId: '71273' }));

    expect(store.getState().byId.has('71273')).toBe(true);
  });

  it('surfaces unmerged work as a VALIDATION error so the user can confirm a second time', async () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord()]);
    installFakeBridge({ 'tickets:archive': { ok: false, code: 'VALIDATION', message: '71273 has 2 unmerged commits', details: { reason: 'unmerged-work' } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useArchiveTicket(store), { wrapper });

    const failure = await act(() => result.current.mutateAsync({ ticketId: '71273' }).catch((error: unknown) => error));

    expect(failure).toBeInstanceOf(IpcError);
    expect(store.getState().byId.has('71273')).toBe(true);
  });

  it('lists archived tickets', async () => {
    installFakeBridge({ 'tickets:archived': { ok: true, data: [archived] } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useArchivedTickets(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([archived]));
  });
});
