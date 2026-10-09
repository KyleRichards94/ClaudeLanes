import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADO_FIXTURE_IDENTITY, adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { agentTickets } from '@/entities/agent-ticket';
import { resetTicketPageTabs } from '@/shared/model';
import { RouterProvider, createRouter, routes, selectRoute } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { TicketPage } from './TicketPage';

vi.setConfig({ testTimeout: 30_000 });

const record = fakeTicketRecord({
  sessionId: 'cc-71273',
  stageHistory: [
    { stage: 'queued', at: 1_000 },
    { stage: 'planning', at: 2_000 },
    { stage: 'implementing', at: 2_000 + 12 * 60_000 },
  ],
  subBranches: [
    { name: 'filter', branch: 'sub/71273-filter', worktreePath: 'C:\\src\\.agent-lanes\\71273-filter', createdAt: 3_000, mergedAt: null },
  ],
});

/** One ready sub-branch for the Merge panel (AL-174). */
const branchStatus = {
  ticketId: '71273',
  checkedAt: 1,
  ticket: {
    worktreePath: record.worktreePath,
    present: true,
    dirty: false,
    changedFiles: 0,
    conflicted: false,
    branch: record.branch,
    baseBranch: 'main',
    baseRef: 'main',
    ahead: 2,
    behind: 0,
  },
  subBranches: [
    {
      name: 'filter',
      branch: 'sub/71273-filter',
      worktreePath: 'C:/src/.agent-lanes/71273-filter',
      present: true,
      dirty: false,
      changedFiles: 0,
      conflicted: false,
      ahead: 4,
      behind: 0,
      finished: true,
      ready: true,
      mergedAt: null,
    },
  ],
};

function renderPage(ticketId = '71273') {
  const router = createRouter(routes.ticket(ticketId));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <TicketPage ticketId={ticketId} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  return router;
}

function setWindowWidth(width: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('TicketPage', () => {
  beforeEach(() => {
    agentTickets.load([]);
    resetTicketPageTabs();
    installFakeBridge({
      'tickets:get': { ok: true, data: { record } },
      'ado:getWorkItem': { ok: true, data: adoFixtureWorkItem(71273) },
      'branches:status': { ok: true, data: branchStatus },
    });
  });

  afterEach(() => {
    setWindowWidth(0);
  });

  it('shows the top bar, meta chips and title from the ticket record and its work item', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Cutover frmJobControl to Blazor', level: 1 })).toBeTruthy();
    expect(screen.getByTestId('ticket-breadcrumb').textContent).toBe('onsite-companion / #71273');
    expect(screen.getByTestId('session-pill').textContent).toMatch(/^Session cc-71273 · /);
    expect(await screen.findByText(`User Story · Active · Sprint 42 · ${ADO_FIXTURE_IDENTITY}`)).toBeTruthy();
  });

  it('adds a ticket the board has not loaded to the store', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    await waitFor(() => expect(agentTickets.getState().byId.get('71273')?.title).toBe('Cutover frmJobControl to Blazor'));
  });

  it('opens the work item in the OS browser', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: 'Open in Azure DevOps' }));
    expect(open).toHaveBeenCalledWith(adoFixtureWorkItem(71273).webUrl, '_blank', 'noopener');
    open.mockRestore();
  });

  it('says when a ticket has no work item', async () => {
    installFakeBridge({ 'tickets:get': { ok: true, data: { record: { ...record, id: 'nt-0710-tidy', ado: null } } } });
    renderPage('nt-0710-tidy');
    expect(await screen.findByText('No Azure DevOps work item')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in Azure DevOps' })).toBeNull();
  });

  it('shows the stepper, the rail cards and the sub-branches', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');

    expect(screen.getByLabelText('Planning, done, 12m')).toBeTruthy();
    expect(screen.getByLabelText('Implementing, current stage')).toBeTruthy();
    expect(screen.getByLabelText('Create PR, upcoming')).toBeTruthy();
    for (const name of ['Worktree', 'Merge', 'Agents', 'Sub-branches']) {
      expect(screen.getByRole('heading', { name, level: 2 })).toBeTruthy();
    }
    expect(await screen.findByText('Merge 1 sub-branch → 71273-cutover-frmjobcontrol-to')).toBeTruthy();
    expect(screen.getByText('sub/71273-filter')).toBeTruthy();
  });

  it('switches tabs in place and opens Claude Design on its own route', async () => {
    const router = renderPage();
    await screen.findByTestId('ticket-title');

    expect(screen.getByRole('tab', { name: 'Output' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('ticket-tab-output')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(await screen.findByTestId('ticket-tab-diff')).toBeTruthy();
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));

    fireEvent.click(screen.getByRole('tab', { name: 'Claude Design' }));
    expect(selectRoute(router.getState())).toEqual(routes.ticketDesign('71273'));
  });

  it('puts the rail beside the output at 1440 wide and under it below 1200', async () => {
    setWindowWidth(1440);
    renderPage();
    await screen.findByTestId('ticket-title');
    expect(screen.getByTestId('ticket-body-wide')).toBeTruthy();

    setWindowWidth(1100);
    expect(await screen.findByTestId('ticket-body-stacked')).toBeTruthy();
  });

  it('offers Retry when the record cannot be loaded', async () => {
    installFakeBridge({ 'tickets:get': { ok: false, code: 'INTERNAL', message: 'disk unavailable' } });
    renderPage();
    expect(await screen.findByText("Couldn't load this ticket.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('says when no ticket has the id', async () => {
    installFakeBridge({ 'tickets:get': { ok: true, data: { record: null } } });
    const router = renderPage('99999');

    expect(await screen.findByText("This ticket isn't on the board. It may have been archived.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: '#99999' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));
    expect(selectRoute(router.getState())).toEqual(routes.board());
  });

  it("shows the ticket's build log in the Build log tab (AL-135)", async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    fireEvent.click(screen.getByRole('tab', { name: 'Build log' }));
    expect(await screen.findByTestId('build-log')).toBeTruthy();
  });

  it('shows the work item chip in the ADO tab (AL-066)', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    fireEvent.click(screen.getByRole('tab', { name: 'ADO' }));
    expect(await screen.findByTestId('ticket-work-item')).toBeTruthy();
  });

  it('goes to the board from the top bar', async () => {
    const router = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '← Board' }));
    expect(selectRoute(router.getState())).toEqual(routes.board());
  });
});
