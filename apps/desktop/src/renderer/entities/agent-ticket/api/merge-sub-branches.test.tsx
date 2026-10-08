import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { IpcError, branchesQueryKey } from '@/shared/api';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { createAgentTicketStore } from '../model/store';
import { useHandConflictToLead, useMergeSubBranches, useOpenConflictFiles } from './merge-sub-branches';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  client.setQueryData(branchesQueryKey('71273'), { stale: false });
  client.setQueryData(['ado', 'workItem', 71273], { id: 71273 });
  client.setQueryData(['ado', 'workItem', 71330], { id: 71330 });
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord()]);
  return { client, wrapper, store };
}

describe('merge sub-branches (AL-086)', () => {
  it("successful merges invalidate ['branches', id] and ['ado', 'workItem', id]", async () => {
    const bridge = installFakeBridge({
      'git:mergeSubBranches': {
        ok: true,
        data: { ticketId: '71273', target: '71273-cutover-job-control', merged: [{ name: 'grid', branch: 'sub/71273-grid', commit: 'abc' }], skipped: [] },
      },
    });
    const { client, wrapper, store } = setup();
    const { result } = renderHook(() => useMergeSubBranches(store), { wrapper });

    await act(() => result.current.mutateAsync({ ticketId: '71273' }));

    expect(bridge.invoke).toHaveBeenCalledWith('git:mergeSubBranches', { ticketId: '71273' });
    expect(client.getQueryState(branchesQueryKey('71273'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['ado', 'workItem', 71273])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['ado', 'workItem', 71330])?.isInvalidated).toBe(false);
  });

  it('a conflict rejects with MERGE_CONFLICT and its files, and still refreshes branch status', async () => {
    installFakeBridge({
      'git:mergeSubBranches': {
        ok: false,
        code: 'MERGE_CONFLICT',
        message: 'Merging sub/71273-footer into 71273-cutover-job-control conflicts in 1 file.',
        details: { reason: 'conflict', branch: 'sub/71273-footer', files: ['JobControl.razor'], fileCount: 1, merged: [] },
      },
    });
    const { client, wrapper, store } = setup();
    const { result } = renderHook(() => useMergeSubBranches(store), { wrapper });

    const failure = await act(() => result.current.mutateAsync({ ticketId: '71273' }).catch((error: unknown) => error));
    expect(failure).toBeInstanceOf(IpcError);
    expect((failure as IpcError).code).toBe('MERGE_CONFLICT');
    expect((failure as IpcError).details).toMatchObject({ files: ['JobControl.razor'] });
    expect(client.getQueryState(branchesQueryKey('71273'))?.isInvalidated).toBe(true);
  });

  it('hands the conflict to the lead agent, or opens the files for the user', async () => {
    const bridge = installFakeBridge({
      'git:handConflictToLead': { ok: true, data: { files: ['JobControl.razor'], held: false } },
      'git:openConflictFiles': { ok: true, data: { opened: ['C:/src/.agent-lanes/71273/JobControl.razor'], fileCount: 1 } },
    });
    const { wrapper } = setup();
    const hand = renderHook(() => useHandConflictToLead(), { wrapper });
    const open = renderHook(() => useOpenConflictFiles(), { wrapper });

    expect(await act(() => hand.result.current.mutateAsync({ ticketId: '71273' }))).toEqual({ files: ['JobControl.razor'], held: false });
    expect(await act(() => open.result.current.mutateAsync({ ticketId: '71273' }))).toMatchObject({ fileCount: 1 });
    expect(bridge.invoke).toHaveBeenCalledWith('git:handConflictToLead', { ticketId: '71273' });
    expect(bridge.invoke).toHaveBeenCalledWith('git:openConflictFiles', { ticketId: '71273' });
  });
});
