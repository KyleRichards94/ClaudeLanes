import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentOutputItem, DiffFilesResponse } from '@agent-lanes/contracts';
import { adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentOutput, resetExpandedRows } from '@/entities/agent-output';
import { agentTickets } from '@/entities/agent-ticket';
import { getTicketView, resetTicketPageTabs, resetTicketViews, selectFile } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { fakeOutputEvent, fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { TicketPage } from './TicketPage';

vi.setConfig({ testTimeout: 30_000 });

const record = fakeTicketRecord({
  sessionId: 'cc-71273',
  stageHistory: [
    { stage: 'queued', at: 1_000 },
    { stage: 'planning', at: 2_000 },
    { stage: 'implementing', at: 2_000 + 12 * 60_000 },
  ],
});

const diff: DiffFilesResponse = {
  ticketId: '71273',
  base: 'main',
  head: record.branch,
  truncated: false,
  reviewStatus: {},
  files: [
    { path: 'src/Pages/JobGrid.razor', oldPath: null, kind: 'added', added: 120, removed: 0, authorAgentId: '71273', touchedBy: ['71273'], uncommitted: false },
    { path: 'src/Forms/frmJobControl.vb', oldPath: null, kind: 'modified', added: 3, removed: 44, authorAgentId: null, touchedBy: [], uncommitted: true },
  ],
};

const lead = { parentToolUseId: null };
const usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const items: AgentOutputItem[] = [
  { kind: 'user', text: 'Cut over the grid', source: 'composer', priority: null, messageId: null, ...lead },
  { kind: 'tool', rowId: 'r1', toolUseIds: ['r1'], tool: 'edit', label: 'Edit', detail: 'src/Pages/JobGrid.razor', stats: '+120 −0', ...lead },
  { kind: 'text', streamId: 'm1', text: 'Grid cut over. Next the filters.', ...lead },
  { kind: 'result', subtype: 'success', isError: false, durationMs: 120_000, numTurns: 1, costUsd: 0.31, usage, ...lead },
  { kind: 'user', text: 'Now the filters', source: 'composer', priority: null, messageId: null, ...lead },
  { kind: 'tool', rowId: 'r2', toolUseIds: ['r2'], tool: 'bash', label: 'Bash', detail: 'dotnet build', stats: null, ...lead },
];

function renderPage() {
  const router = createRouter(routes.ticket('71273'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <TicketPage ticketId="71273" />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

describe('Flight deck on the ticket page (AL-279)', () => {
  beforeEach(() => {
    agentTickets.load([]);
    resetTicketPageTabs();
    resetTicketViews();
    resetExpandedRows();
    installFakeBridge({
      'tickets:get': { ok: true, data: { record } },
      'ado:getWorkItem': { ok: true, data: adoFixtureWorkItem(71273) },
      'diff:files': { ok: true, data: diff },
    });
  });

  it('shows the workflow card, the grouped output, the change map and the rail', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    expect(screen.getByTestId('flight-deck')).toBeTruthy();
    // The stage cards keep their names and meta; Planning took 12 minutes.
    expect(screen.getByLabelText('Planning, done, 12m')).toBeTruthy();
    expect(screen.getByLabelText('Implementing, current stage')).toBeTruthy();
    expect(screen.getByTestId('ticket-tab-output')).toBeTruthy();
    expect(screen.getByTestId('composer')).toBeTruthy();

    const map = await screen.findByTestId('change-map');
    expect(within(map).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('diff-totals').textContent).toBe('2 files · +123 −44');
    expect(screen.getByText('Includes uncommitted changes')).toBeTruthy();
    // The biggest change is shown until one is picked.
    expect(screen.getByTestId('diff-file-path').textContent).toBe('src/Pages/JobGrid.razor');
    expect(screen.getByTestId('diff-file-author').textContent).toBe('by Lead');

    const rail = screen.getByTestId('ticket-side-column');
    for (const name of ['Agents', 'Worktree', 'Merge', 'Sub-branches']) expect(within(rail).getByRole('heading', { name, level: 2 })).toBeTruthy();
    expect(within(rail).getByTestId('assign-agent-open')).toBeTruthy();
    expect(within(rail).getByTestId('add-agent-open')).toBeTruthy();
  });

  it('sets selectedFilePath when a change-map tile is pressed, and Esc clears it', async () => {
    renderPage();
    const tile = await screen.findByTestId('change-tile-src/Forms/frmJobControl.vb');
    fireEvent.click(tile);
    expect(getTicketView('71273').selectedFilePath).toBe('src/Forms/frmJobControl.vb');
    await waitFor(() => expect(screen.getByTestId('diff-file-path').textContent).toBe('src/Forms/frmJobControl.vb'));
    expect(screen.getByTestId('diff-file-author').textContent).toBe('by you or a merge');

    fireEvent.keyDown(screen.getByTestId('ticket-page'), { key: 'Escape' });
    expect(getTicketView('71273').selectedFilePath).toBeNull();
    await waitFor(() => expect(screen.getByTestId('diff-file-path').textContent).toBe('src/Pages/JobGrid.razor'));
  });

  it('keeps a file picked in the other layout selected', async () => {
    renderPage();
    await screen.findByTestId('change-map');
    act(() => selectFile('71273', 'src/Forms/frmJobControl.vb'));
    await waitFor(() => expect(screen.getByTestId('diff-file-path').textContent).toBe('src/Forms/frmJobControl.vb'));
  });

  it('sets selectedTurn when a turn in the strip is pressed, and groups finished turns in the output', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    act(() => agentOutput.receive(items.map((item, index) => fakeOutputEvent('71273', 5_000 + index * 100, { seq: index + 1, item }))));

    const strip = await screen.findByTestId('turn-strip');
    expect(within(strip).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('turn-total').textContent).toBe('2 turns · $0.31');
    fireEvent.click(screen.getByTestId('turn-1'));
    expect(getTicketView('71273').selectedTurn).toBe(1);

    // The first turn is one summary row; the second is live, open.
    const row = screen.getByTestId('turn-row-1');
    expect(within(row).getByText('Grid cut over.')).toBeTruthy();
    expect(screen.queryByText('Cut over the grid')).toBeNull();
    expect(screen.getByText('dotnet build')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText('Cut over the grid')).toBeTruthy();
  });

  it('hides and shows the diff column, and keeps the Build log and ADO tabs reachable', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    expect(await screen.findByTestId('ticket-tab-diff')).toBeTruthy();

    fireEvent.click(screen.getByTestId('toggle-diff-pane'));
    expect(screen.queryByTestId('ticket-tab-diff')).toBeNull();
    expect(screen.getByTestId('ticket-tab-output')).toBeTruthy();
    fireEvent.click(screen.getByTestId('toggle-diff-pane'));
    expect(await screen.findByTestId('ticket-tab-diff')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Build log' }));
    expect(await screen.findByTestId('build-log')).toBeTruthy();
    expect(screen.queryByTestId('ticket-tab-output')).toBeNull();
    expect(screen.getByTestId('ticket-side-column')).toBeTruthy();
  });
});
