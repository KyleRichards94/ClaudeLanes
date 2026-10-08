import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { getConnectionsModal, resetConnectionsModal, useUiPrefs } from '@/shared/model';
import { RouterProvider, createRouter } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { BoardPage } from './BoardPage';

const fixture = adoFixture();

const appInfo = {
  ok: true,
  data: {
    name: 'Agent Lanes',
    version: '0.1.0',
    platform: 'win32',
    versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createRouter()}>
        <BoardPage />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => agentTickets.load([]));

describe('BoardPage', () => {
  it('shows the board title and the runtime from the main process', async () => {
    installFakeBridge({ 'app:getInfo': appInfo, 'tickets:list': { ok: true, data: [] } });

    renderPage();

    expect(screen.getByText('Agent board')).toBeTruthy();
    expect(await screen.findByText('v0.1.0 · Electron 44.6.0 · win32')).toBeTruthy();
  });

  it('says so when the main process cannot be reached', async () => {
    installFakeBridge({ 'app:getInfo': { ok: false, code: 'INTERNAL', message: 'down' } });
    renderPage();
    expect(await screen.findByText('Main process unreachable')).toBeTruthy();
  });

  it('loads the ticket records into the lanes', async () => {
    installFakeBridge({
      'app:getInfo': appInfo,
      'tickets:list': { ok: true, data: [fakeTicketRecord({ id: '71273', stage: 'implementing' }), fakeTicketRecord({ id: '71330', stage: 'queued' })] },
    });
    renderPage();

    expect(await within(screen.getByTestId('lane-implementing')).findByRole('button', { name: /^#71273/ })).toBeTruthy();
    expect(within(screen.getByTestId('lane-queued')).getByRole('button', { name: /^#71330/ })).toBeTruthy();
  });
});

describe('BoardPage header (AL-046)', () => {
  it('opens Connections from its Connections button', () => {
    resetConnectionsModal();
    installFakeBridge({ 'app:getInfo': { ok: false, code: 'INTERNAL', message: 'not needed here' } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
    expect(getConnectionsModal()).toMatchObject({ open: true, tab: 'ado', target: null });
    resetConnectionsModal();
  });
});

describe('BoardPage header (AL-142)', () => {
  const repo = (name: string) => ({
    name,
    path: `C:\\src\\${name}`,
    baseBranch: 'main',
    worktreeRoot: 'C:\\src\\.agent-lanes',
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: 3,
  });
  const repos = [repo('onsite-companion'), repo('liink')];

  afterEach(() => {
    useUiPrefs.setState({ lastRepo: null, lastSprint: null });
  });

  function boardBridge(extra: Parameters<typeof installFakeBridge>[0] = {}) {
    return installFakeBridge({
      'app:getInfo': appInfo,
      'tickets:list': {
        ok: true,
        data: [
          fakeTicketRecord({ id: '71273', stage: 'implementing' }),
          fakeTicketRecord({ id: '71301', stage: 'code-review', title: 'Defect request accept modal' }),
          fakeTicketRecord({ id: '71330', stage: 'queued', title: 'Asset register paging slow above 5k rows' }),
        ],
      },
      'ado:listSprints': { ok: true, data: fixture.sprints },
      'repos:list': { ok: true, data: repos },
      // The running sessions' MCP servers (AL-108's live pill).
      'agent:getMcpStatus': { ok: true, data: { state: 'online', servers: [{ name: 'azure-devops', state: 'connected', error: null, ticketIds: ['71273'] }] } },
      ...extra,
    });
  }

  it('shows the counts, the sprint sub-header, the legend and MCP status', async () => {
    boardBridge();
    renderPage();

    expect(await screen.findByText('2 running')).toBeTruthy();
    expect(screen.getByText('0 need you')).toBeTruthy();
    expect(screen.getByText('1 queued')).toBeTruthy();
    expect(await screen.findByText('MCP online')).toBeTruthy();
    expect(await screen.findByText(/^Sprint 42 · 7 (– 20 Oct|Oct 2026 – 20 Oct 2026) · 3 agent tickets$/)).toBeTruthy();
    expect(screen.getByTestId('board-sprint').textContent).toBe('42');
    for (const entry of ['Azure DevOps', 'Claude activity', 'Needs you']) expect(within(screen.getByTestId('board-legend')).getByText(entry)).toBeTruthy();
  });

  it('updates the counts live from the store and filters the lanes to the tickets that need you', async () => {
    boardBridge();
    renderPage();
    await screen.findByText('2 running');
    const needYou = screen.getByTestId('board-count-needs-you');
    expect(needYou.getAttribute('aria-disabled')).toBe('true');

    act(() => agentTickets.openGate('71301', 'code-review', 5_000));
    expect(screen.getByText('1 running')).toBeTruthy();
    expect(screen.getByText('1 need you')).toBeTruthy();

    fireEvent.click(needYou);
    expect(needYou.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('board-needs-you-filter').textContent).toContain('Showing the ticket that need you');
    expect(within(screen.getByTestId('lane-code-review')).getByRole('button', { name: /^#71301/ })).toBeTruthy();
    expect(within(screen.getByTestId('lane-implementing')).queryByRole('button', { name: /^#71273/ })).toBeNull();
    expect(within(screen.getByTestId('lane-implementing')).getByText('Nothing in Implementing needs you')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all tickets' }));
    expect(within(screen.getByTestId('lane-implementing')).getByRole('button', { name: /^#71273/ })).toBeTruthy();
    expect(screen.queryByTestId('board-needs-you-filter')).toBeNull();
  });

  it('switches repo and sprint from the dropdowns', async () => {
    useUiPrefs.setState({ lastRepo: repos[0]?.path ?? null });
    boardBridge();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('board-repo').textContent).toBe('onsite-companion'));
    fireEvent.click(screen.getByRole('button', { name: 'Repo: onsite-companion' }));
    const repoMenu = await screen.findByRole('menu', { name: 'Repo' });
    expect(within(repoMenu).getByRole('menuitem', { name: 'onsite-companion, selected' })).toBeTruthy();
    expect(within(repoMenu).getByRole('menuitem', { name: 'Add repo…' })).toBeTruthy();
    fireEvent.click(within(repoMenu).getByRole('menuitem', { name: 'liink' }));
    expect(useUiPrefs.getState().lastRepo).toBe(repos[1]?.path);
    expect(screen.getByTestId('board-repo').textContent).toBe('liink');
    expect(screen.queryByRole('menu')).toBeNull();

    await screen.findByText('42');
    fireEvent.click(screen.getByRole('button', { name: 'Sprint: 42' }));
    const sprintMenu = await screen.findByRole('menu', { name: 'Sprint' });
    fireEvent.click(within(sprintMenu).getByRole('menuitem', { name: 'Sprint 43' }));
    expect(useUiPrefs.getState().lastSprint).toBe(fixture.sprints.sprints[3]?.id);
    expect(screen.getByTestId('board-sprint').textContent).toBe('43');
  });

  it('adds a repo from the Repo menu and shows it', async () => {
    const added = repo('new-repo');
    const bridge = boardBridge({ 'repos:add': { ok: true, data: { status: 'added', repo: added, repos: [...repos, added] } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^Repo: / }));
    fireEvent.click(within(await screen.findByRole('menu', { name: 'Repo' })).getByRole('menuitem', { name: 'Add repo…' }));
    await waitFor(() => expect(screen.getByTestId('board-repo').textContent).toBe('new-repo'));
    expect(bridge.invoke).toHaveBeenCalledWith('repos:add', undefined);
  });
});
