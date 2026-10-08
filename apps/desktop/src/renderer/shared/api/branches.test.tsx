import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { BranchStatus } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fakeStageEvent, fakeSubagentEvent, installFakeBridge } from '@/shared/testing';
import { branchesQueryKey, createBranchStatusEventHandlers, useBranchStatus } from './branches';

const status: BranchStatus = {
  ticketId: '71273',
  ticket: {
    worktreePath: 'C:\\src\\.agent-lanes\\71273',
    present: true,
    dirty: false,
    changedFiles: 0,
    conflicted: false,
    branch: '71273-cutover-job-control',
    baseBranch: 'main',
    baseRef: 'main',
    ahead: 12,
    behind: 0,
  },
  subBranches: [
    {
      worktreePath: 'C:\\src\\.agent-lanes\\71273--filter',
      present: true,
      dirty: false,
      changedFiles: 0,
      conflicted: false,
      name: 'filter',
      branch: 'sub/71273-filter',
      ahead: 4,
      behind: 0,
      finished: true,
      ready: true,
      mergedAt: null,
    },
  ],
  checkedAt: 1,
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('branch status query', () => {
  it("useBranchStatus reads branches:status under ['branches', ticketId]", async () => {
    const bridge = installFakeBridge({ 'branches:status': { ok: true, data: status } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useBranchStatus('71273'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(status));
    expect(bridge.invoke).toHaveBeenCalledWith('branches:status', { ticketId: '71273' });
    expect(client.getQueryData(['branches', '71273'])).toEqual(status);
  });

  it("a sub-agent starting or finishing (agent:subagent) invalidates that ticket's branch status only", async () => {
    const { client } = setup();
    client.setQueryData(branchesQueryKey('71273'), status);
    client.setQueryData(branchesQueryKey('71330'), { ...status, ticketId: '71330' });
    const handlers = createBranchStatusEventHandlers(client);

    // Progress in between changes neither its branch nor whether it is ready.
    handlers['agent:subagent']?.(fakeSubagentEvent('71273', 4, { change: 'updated' }));
    expect(client.getQueryState(branchesQueryKey('71273'))?.isInvalidated).toBe(false);

    handlers['agent:subagent']?.(fakeSubagentEvent('71273', 5, { change: 'finished' }));

    expect(client.getQueryState(branchesQueryKey('71273'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(branchesQueryKey('71330'))?.isInvalidated).toBe(false);
  });

  it("the lead agent's turn ending or a stage change invalidates that ticket's branch status (AL-222)", async () => {
    const { client } = setup();
    const handlers = createBranchStatusEventHandlers(client);
    const fresh = () => {
      client.setQueryData(branchesQueryKey('71273'), status);
      client.setQueryData(branchesQueryKey('71330'), { ...status, ticketId: '71330' });
    };
    const invalidated = (ticketId: string) => client.getQueryState(branchesQueryKey(ticketId))?.isInvalidated;

    // A turn starting or an activity update changes nothing on disk yet.
    fresh();
    handlers['agent:status']?.({ ticketId: '71273', at: 1, state: 'running', sessionId: 's-1', message: null });
    handlers['agent:stage']?.(fakeStageEvent('71273', 2, { change: 'activity', from: null }));
    expect(invalidated('71273')).toBe(false);

    // The turn ended: the agent may have committed.
    handlers['agent:status']?.({ ticketId: '71273', at: 3, state: 'idle', sessionId: 's-1', message: null });
    expect(invalidated('71273')).toBe(true);
    expect(invalidated('71330')).toBe(false);

    fresh();
    handlers['agent:stage']?.(fakeStageEvent('71273', 4, { change: 'stage', stage: 'code-review', from: 'implementing' }));
    expect(invalidated('71273')).toBe(true);
    expect(invalidated('71330')).toBe(false);
  });
});
