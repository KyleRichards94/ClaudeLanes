import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickSprint, pullRequestRef } from '@agent-lanes/contracts';
import { ADO_FIXTURE_SPRINT_42_PATH, adoFixture } from '@agent-lanes/contracts/testing';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import {
  ADO_REFETCH_INTERVAL_MS,
  adoKeys,
  usePullRequest,
  useSprints,
  useWorkItem,
  useWorkItemSearch,
  useWorkItems,
  windowVisibilityEventHandlers,
} from './ado';
import { connectionsEventHandlers } from './connections';

const fixture = adoFixture();
const sprint42 = fixture.sprints.sprints.find((sprint) => sprint.path === ADO_FIXTURE_SPRINT_42_PATH);
const [snapshot] = fixture.pullRequests;

let bridge: FakeBridge;
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function calls(channel: string): number {
  return vi.mocked(bridge.invoke).mock.calls.filter(([name]) => name === channel).length;
}

/** `app:window` from main, as the event hub hands it over. */
function windowVisible(visible: boolean) {
  act(() => windowVisibilityEventHandlers['app:window']?.({ at: Date.now(), visible }));
}

beforeEach(() => {
  bridge = installFakeBridge({
    'ado:listSprints': { ok: true, data: fixture.sprints },
    'ado:listWorkItems': { ok: true, data: fixture.workItems.slice(0, 4) },
    'ado:searchWorkItems': { ok: true, data: fixture.workItems.slice(0, 1) },
    'ado:getWorkItem': { ok: true, data: fixture.workItems[0] },
    'ado:getPullRequest': { ok: true, data: snapshot },
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: ADO_REFETCH_INTERVAL_MS } } });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  client.clear();
  vi.useRealTimers();
});

describe('ADO query keys (AL-066)', () => {
  it('nests every key under ["ado"], with the design §6 work item key', () => {
    expect(adoKeys.workItem(71273)).toEqual(['ado', 'workItem', 71273]);
    expect(adoKeys.workItem(71273, 'ado:contoso')).toEqual(['ado', 'workItem', 71273, 'ado:contoso']);
    expect(adoKeys.sprints()).toEqual(['ado', 'sprints', {}]);
    expect(adoKeys.workItems('P\\Sprint 42')).toEqual(['ado', 'workItems', 'P\\Sprint 42', {}]);
    expect(adoKeys.search('71273')).toEqual(['ado', 'search', '71273', {}]);
    expect(adoKeys.pullRequest({ project: 'p', repository: 'r', pullRequestId: 10612 })).toEqual(['ado', 'pullRequest', 'p', 'r', 10612]);
    for (const key of [adoKeys.sprints(), adoKeys.search('x'), adoKeys.workItem(1)]) expect(key[0]).toBe(adoKeys.all[0]);
  });
});

describe('ADO query hooks (AL-066)', () => {
  it('reads sprints, a sprint’s work items, a search, one work item and a pull request', async () => {
    const sprints = renderHook(() => useSprints(), { wrapper });
    await waitFor(() => expect(sprints.result.current.data).toEqual(fixture.sprints));
    expect(pickSprint(fixture.sprints)?.path).toBe(ADO_FIXTURE_SPRINT_42_PATH);

    const items = renderHook(() => useWorkItems(sprint42), { wrapper });
    await waitFor(() => expect(items.result.current.data).toHaveLength(4));
    expect(bridge.invoke).toHaveBeenCalledWith('ado:listWorkItems', { iterationPath: ADO_FIXTURE_SPRINT_42_PATH });

    const search = renderHook(() => useWorkItemSearch(' 71273 '), { wrapper });
    await waitFor(() => expect(search.result.current.data?.[0]?.id).toBe(71273));
    expect(bridge.invoke).toHaveBeenCalledWith('ado:searchWorkItems', { query: '71273' });

    const item = renderHook(() => useWorkItem(71273), { wrapper });
    await waitFor(() => expect(item.result.current.data?.id).toBe(71273));

    const ref = snapshot ? pullRequestRef(snapshot.pullRequest) : null;
    const pr = renderHook(() => usePullRequest(ref), { wrapper });
    await waitFor(() => expect(pr.result.current.data?.pullRequest.id).toBe(10612));
  });

  it('stays idle without a sprint, a query, an id or a pull request', () => {
    renderHook(
      () => {
        useWorkItems(null);
        useWorkItemSearch('   ');
        useWorkItem(null);
        usePullRequest(null);
      },
      { wrapper },
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it('refetches everything ADO when connections change', async () => {
    const item = renderHook(() => useWorkItem(71273), { wrapper });
    await waitFor(() => expect(item.result.current.isSuccess).toBe(true));
    await act(async () => connectionsEventHandlers(client)['connections:changed']?.({ at: 1 }));
    await waitFor(() => expect(calls('ado:getWorkItem')).toBe(2));
  });
});

describe('ADO refetch policy (AL-066, design §6)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('polls every 60 s while the board is open and the window can be seen', async () => {
    renderHook(() => useWorkItems(sprint42, {}, { live: true }), { wrapper });
    await settle();
    expect(calls('ado:listWorkItems')).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(ADO_REFETCH_INTERVAL_MS));
    expect(calls('ado:listWorkItems')).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(ADO_REFETCH_INTERVAL_MS));
    expect(calls('ado:listWorkItems')).toBe(3);
  });

  it('does not poll while the window is minimised or hidden, and refetches when it comes back', async () => {
    renderHook(() => useSprints({}, { live: true }), { wrapper });
    await settle();
    expect(calls('ado:listSprints')).toBe(1);

    windowVisible(false);
    await act(() => vi.advanceTimersByTimeAsync(ADO_REFETCH_INTERVAL_MS * 5));
    expect(calls('ado:listSprints')).toBe(1);

    windowVisible(true);
    await settle();
    expect(calls('ado:listSprints')).toBe(2);
  });

  it('does not poll off the board (no `live`)', async () => {
    renderHook(() => useWorkItem(71273), { wrapper });
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(ADO_REFETCH_INTERVAL_MS * 3));
    expect(calls('ado:getWorkItem')).toBe(1);
  });
});
