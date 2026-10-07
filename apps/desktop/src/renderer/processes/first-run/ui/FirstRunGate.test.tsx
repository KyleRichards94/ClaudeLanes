import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type RepoSettings, type Settings } from '@agent-lanes/contracts';
import { Text } from '@agent-lanes/ui';
import { connectionsQueryKey } from '@/shared/api';
import { getConnectionsModal, hydrateUiPrefs, resetConnectionsModal, useUiPrefs } from '@/shared/model';
import { fakeAdoRow, fakeClaudeRow, fakeConnections, installFakeSettings, type FakeConnections } from '@/shared/testing';
import { firstRunStep, isFirstRunSkipped } from '../model/first-run';
import { FirstRunGate } from './FirstRunGate';

const repo: RepoSettings = {
  path: 'C:\\src\\OnSiteCompanion',
  name: 'OnSiteCompanion',
  baseBranch: 'main',
  worktreeRoot: 'C:\\src\\.agent-lanes',
  buildCommand: null,
  runCommand: null,
  maxConcurrentAgents: 3,
};

interface Setup {
  connections: FakeConnections;
  client: QueryClient;
  repos: RepoSettings[];
}

async function setup({ settings = defaultSettings(), rows = [], repos = [] as RepoSettings[], skip = false } = {} as {
  settings?: Settings;
  rows?: Parameters<typeof fakeConnections>[1];
  repos?: RepoSettings[];
  skip?: boolean;
}): Promise<Setup> {
  const state = { repos: [...repos] };
  const fake = installFakeSettings({ ...settings, repos: state.repos }, {
    'repos:list': { ok: true, data: state.repos },
  });
  const bridge = fake.bridge as Parameters<typeof fakeConnections>[0];
  // `repos:add`: the folder picker returns the fixture repo.
  const settingsInvoke = bridge.invoke;
  bridge.invoke = async (channel, payload) => {
    if (channel === 'repos:list') return { ok: true, data: state.repos };
    if (channel === 'repos:add') {
      state.repos = [repo];
      return { ok: true, data: { status: 'added', repo, repos: state.repos } };
    }
    return settingsInvoke(channel, payload);
  };
  const connections = fakeConnections(bridge, rows);
  await hydrateUiPrefs();

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FirstRunGate skip={skip}>
        <Text>Agent board</Text>
      </FirstRunGate>
    </QueryClientProvider>,
  );
  return { connections, client, repos: state.repos };
}

describe('first run (AL-047)', () => {
  beforeEach(() => {
    resetConnectionsModal();
    useUiPrefs.setState({ lastRepo: null });
  });

  it('decides the step from what is saved', () => {
    const ado = fakeAdoRow();
    const claude = fakeClaudeRow();
    expect(firstRunStep({ connections: [], repos: [], lastRepo: null })).toBe('connect');
    expect(firstRunStep({ connections: [ado], repos: [repo], lastRepo: repo.path })).toBe('connect');
    expect(firstRunStep({ connections: [claude], repos: [repo], lastRepo: repo.path })).toBe('connect');
    expect(firstRunStep({ connections: [ado, claude], repos: [], lastRepo: null })).toBe('repo');
    expect(firstRunStep({ connections: [ado, claude], repos: [repo], lastRepo: 'C:\\gone' })).toBe('repo');
    expect(firstRunStep({ connections: [ado, claude], repos: [repo], lastRepo: repo.path })).toBe('done');
  });

  it('reads the e2e skip from the page query only', () => {
    expect(isFirstRunSkipped('?firstRun=skip')).toBe(true);
    expect(isFirstRunSkipped('')).toBe(false);
    expect(isFirstRunSkipped('?firstRun=no')).toBe(false);
  });

  it('on a fresh profile, blocks the board with Connections, then Pick a repo, then opens the board for that repo', async () => {
    const { connections, client } = await setup();

    await waitFor(() => expect(getConnectionsModal()).toMatchObject({ open: true, blocking: true, tab: 'ado' }));
    expect(screen.queryByRole('dialog', { name: 'Pick a repo' })).toBeNull();

    // Saving one organisation is not enough.
    connections.rows = [fakeAdoRow()];
    await act(() => client.invalidateQueries({ queryKey: connectionsQueryKey }));
    expect(getConnectionsModal()).toMatchObject({ open: true, blocking: true });

    connections.rows = [fakeAdoRow(), fakeClaudeRow()];
    await act(() => client.invalidateQueries({ queryKey: connectionsQueryKey }));
    const pick = await screen.findByRole('dialog', { name: 'Pick a repo' });
    expect(getConnectionsModal()).toMatchObject({ open: false, blocking: false });
    // Blocking: no close button.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    fireEvent.click(screen.getByTestId('pick-repo-choose'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pick a repo' })).toBeNull());
    expect(pick.isConnected).toBe(false);
    expect(useUiPrefs.getState().lastRepo).toBe(repo.path);
    expect(screen.getByText('Agent board')).toBeTruthy();
  });

  it('goes straight to the board on a second launch', async () => {
    const settings = { ...defaultSettings(), ui: { ...defaultSettings().ui, lastRepo: repo.path } };
    await setup({ settings, rows: [fakeAdoRow(), fakeClaudeRow()], repos: [repo] });

    expect(await screen.findByText('Agent board')).toBeTruthy();
    expect(getConnectionsModal().open).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Pick a repo' })).toBeNull();
  });

  it('offers repos already registered when the last one is gone', async () => {
    const other = { ...repo, path: 'C:\\src\\Hicora', name: 'Hicora' };
    await setup({ rows: [fakeAdoRow(), fakeClaudeRow()], repos: [other] });
    fireEvent.click(await screen.findByTestId('pick-repo-Hicora'));
    expect(useUiPrefs.getState().lastRepo).toBe(other.path);
  });

  it('does nothing when skipped', async () => {
    await setup({ skip: true });
    expect(screen.getByText('Agent board')).toBeTruthy();
    expect(getConnectionsModal().open).toBe(false);
  });
});
