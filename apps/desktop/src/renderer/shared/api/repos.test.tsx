import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { defaultSettings, type RepoSettings } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { reposQueryKey, useAddRepo, useRemoveRepo, useRepos } from './repos';
import { settingsQueryKey } from './settings';

function repo(path: string, name: string): RepoSettings {
  return {
    path,
    name,
    baseBranch: 'main',
    worktreeRoot: 'C:\\src\\.agent-lanes',
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: 3,
  };
}

const osc = repo('C:\\src\\onsite-companion', 'onsite-companion');
const lanes = repo('C:\\src\\agent-lanes', 'agent-lanes');

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('repo queries', () => {
  it('useRepos loads the registered repos from the main process', async () => {
    installFakeBridge({ 'repos:list': { ok: true, data: [osc, lanes] } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useRepos(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([osc, lanes]));
  });

  it('useAddRepo asks main to open the picker and puts the new list in both caches', async () => {
    const bridge = installFakeBridge({ 'repos:add': { ok: true, data: { status: 'added', repo: lanes, repos: [osc, lanes] } } });
    const { client, wrapper } = setup();
    client.setQueryData(reposQueryKey, [osc]);
    client.setQueryData(settingsQueryKey, { ...defaultSettings(), repos: [osc] });
    const { result } = renderHook(() => useAddRepo(), { wrapper });

    const outcome = await act(() => result.current.mutateAsync());

    expect(bridge.invoke).toHaveBeenCalledWith('repos:add', undefined);
    expect(outcome).toEqual({ status: 'added', repo: lanes, repos: [osc, lanes] });
    expect(client.getQueryData(reposQueryKey)).toEqual([osc, lanes]);
    expect(client.getQueryData(settingsQueryKey)).toMatchObject({ repos: [osc, lanes] });
  });

  it('useAddRepo resolves a refused folder as rejected, since main has already explained it', async () => {
    const folder = 'C:\\Users\\kyle\\Downloads';
    installFakeBridge({ 'repos:add': { ok: true, data: { status: 'rejected', reason: 'not-a-repo', folder, repos: [osc] } } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useAddRepo(), { wrapper });

    await expect(act(() => result.current.mutateAsync())).resolves.toEqual({
      status: 'rejected',
      reason: 'not-a-repo',
      folder,
      repos: [osc],
    });
    expect(client.getQueryData(reposQueryKey)).toEqual([osc]);
  });

  it('useAddRepo surfaces a failure the caller has to report', async () => {
    installFakeBridge({ 'repos:add': { ok: false, code: 'INTERNAL', message: 'Agent Lanes needs Git 2.38 or later' } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAddRepo(), { wrapper });

    await expect(result.current.mutateAsync()).rejects.toMatchObject({ code: 'INTERNAL', message: 'Agent Lanes needs Git 2.38 or later' });
  });

  it('useRemoveRepo sends the path and stores the repos left', async () => {
    const bridge = installFakeBridge({ 'repos:remove': { ok: true, data: { removed: true, repos: [lanes] } } });
    const { client, wrapper } = setup();
    client.setQueryData(reposQueryKey, [osc, lanes]);
    const { result } = renderHook(() => useRemoveRepo(), { wrapper });

    await act(() => result.current.mutateAsync(osc.path));

    expect(bridge.invoke).toHaveBeenCalledWith('repos:remove', { path: osc.path });
    expect(client.getQueryData(reposQueryKey)).toEqual([lanes]);
    // No settings were cached, so there is nothing to patch there.
    expect(client.getQueryData(settingsQueryKey)).toBeUndefined();
  });
});
