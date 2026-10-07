import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MergeToMainPreview } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { IpcError, branchesQueryKey } from '@/shared/api';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { createAgentTicketStore } from '../model/store';
import { mergeToMainPreviewQueryKey, mergedActivityText, useMergeToMain, useMergeToMainPreview } from './merge-to-main';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

/** 7 October 2026 15:20 local time. */
const MERGED_AT = new Date(2026, 9, 7, 15, 20).getTime();

describe('merge worktree → main', () => {
  it('formats the Done card activity as "Merged into main · 15:20"', () => {
    expect(mergedActivityText('main', MERGED_AT)).toBe('Merged into main · 15:20');
    expect(mergedActivityText('release/7.2', new Date(2026, 9, 7, 9, 5).getTime())).toBe('Merged into release/7.2 · 09:05');
  });

  it('moves the card to Done with "Merged into main · 15:20" and refreshes branch status and the work item', async () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ stage: 'create-pr' })]);
    const done = fakeTicketRecord({ stage: 'done', stageEnteredAt: MERGED_AT });
    const bridge = installFakeBridge({
      'git:mergeToMain': { ok: true, data: { record: done, target: 'main', mergeCommit: 'abc123', pushed: true, mergedAt: MERGED_AT } },
    });
    const { client, wrapper } = setup();
    client.setQueryData(branchesQueryKey('71273'), { stale: false });
    client.setQueryData(['ado', 'workItem', 71273], { id: 71273 });
    const { result } = renderHook(() => useMergeToMain(store), { wrapper });

    await act(() => result.current.mutateAsync({ ticketId: '71273' }));

    expect(bridge.invoke).toHaveBeenCalledWith('git:mergeToMain', { ticketId: '71273', confirmed: true });
    const ticket = store.getState().byId.get('71273');
    expect(ticket?.stage).toBe('done');
    expect(ticket?.activity?.text).toBe('Merged into main · 15:20');
    expect(store.getState().byLane.done).toEqual(['71273']);
    expect(client.getQueryState(branchesQueryKey('71273'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['ado', 'workItem', 71273])?.isInvalidated).toBe(true);
  });

  it('leaves the card where it is when main refuses a dirty worktree', async () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ stage: 'create-pr' })]);
    installFakeBridge({
      'git:mergeToMain': { ok: false, code: 'GIT_DIRTY', message: 'uncommitted changes', details: { reason: 'worktree-dirty', files: ['a.cs'] } },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeToMain(store), { wrapper });

    const failure = await act(() => result.current.mutateAsync({ ticketId: '71273' }).catch((error: unknown) => error));

    expect(failure).toBeInstanceOf(IpcError);
    expect((failure as IpcError).code).toBe('GIT_DIRTY');
    expect(store.getState().byId.get('71273')?.stage).toBe('create-pr');
  });

  it('loads the confirm modal preview under the ticket branch status key', async () => {
    const preview: MergeToMainPreview = {
      ticketId: '71273',
      source: '71273-cutover-job-control',
      target: 'main',
      repo: 'C:\\src\\onsite-companion',
      qaPassed: false,
      worktree: { worktreePath: 'C:\\src\\.agent-lanes\\71273', present: true, dirty: false, changedFiles: 0, conflicted: false },
      ahead: 12,
      alreadyMerged: false,
    };
    installFakeBridge({ 'git:mergeToMainPreview': { ok: true, data: preview } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useMergeToMainPreview('71273'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(preview));
    expect(mergeToMainPreviewQueryKey('71273').slice(0, 2)).toEqual(['branches', '71273']);
    await client.invalidateQueries({ queryKey: branchesQueryKey('71273'), refetchType: 'none' });
    expect(client.getQueryState(mergeToMainPreviewQueryKey('71273'))?.isInvalidated).toBe(true);
  });
});
