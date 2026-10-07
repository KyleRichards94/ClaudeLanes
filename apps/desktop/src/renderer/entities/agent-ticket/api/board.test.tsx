import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TicketBoard } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { createAgentTicketStore } from '../model/store';
import { ticketBoardQueryKey, useAdoptWorktree, useIgnoreWorktree, useTicketBoard } from './board';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const implementing = fakeTicketRecord({ id: '71273', stage: 'implementing', model: 'sonnet', effort: 'high', sessionId: 'cc-71273' });
const qa = fakeTicketRecord({ id: '71330', stage: 'qa' });
const board: TicketBoard = {
  tickets: [implementing, qa],
  missingWorktrees: [{ ticketId: '71330', worktreePath: 'C:\\src\\.agent-lanes\\71330', subBranch: null }],
  orphans: [],
  recordIssues: [],
  unreadableRepos: [],
};

describe('start-up board', () => {
  it('rebuilds the cards from the reconciled records: same lanes, model/effort and session', async () => {
    installFakeBridge({ 'tickets:board': { ok: true, data: board } });
    const store = createAgentTicketStore();
    const { wrapper } = setup();
    const { result } = renderHook(() => useTicketBoard(store), { wrapper });

    await waitFor(() => expect(store.getState().byId.size).toBe(2));
    expect(store.getState().byLane.implementing).toEqual(['71273']);
    expect(store.getState().byLane.qa).toEqual(['71330']);
    expect(store.getState().byId.get('71273')).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(result.current.data?.missingWorktrees).toEqual(board.missingWorktrees);
  });

  it('adopting a worktree adds its card and reloads the board; ignoring reloads it', async () => {
    const adopted = fakeTicketRecord({ id: '71300', stage: 'queued' });
    const bridge = installFakeBridge({
      'tickets:adoptWorktree': { ok: true, data: { record: adopted, adoptedAs: 'ticket' } },
      'tickets:ignoreWorktree': { ok: true, data: { ignored: ['C:\\src\\.agent-lanes\\scratch'] } },
    });
    const store = createAgentTicketStore();
    const { client, wrapper } = setup();
    client.setQueryData(ticketBoardQueryKey, board);
    const adopt = renderHook(() => useAdoptWorktree(store), { wrapper });

    await act(() => adopt.result.current.mutateAsync('C:\\src\\.agent-lanes\\71300'));

    expect(bridge.invoke).toHaveBeenCalledWith('tickets:adoptWorktree', { worktreePath: 'C:\\src\\.agent-lanes\\71300' });
    expect(store.getState().byLane.queued).toEqual(['71300']);
    expect(client.getQueryState(ticketBoardQueryKey)?.isInvalidated).toBe(true);

    client.setQueryData(ticketBoardQueryKey, board);
    const ignore = renderHook(() => useIgnoreWorktree(), { wrapper });
    await act(() => ignore.result.current.mutateAsync('C:\\src\\.agent-lanes\\scratch'));
    expect(client.getQueryState(ticketBoardQueryKey)?.isInvalidated).toBe(true);
  });
});
