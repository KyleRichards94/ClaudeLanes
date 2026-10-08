import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { defaultSettings, type LaunchFromAdoResponse, type TeamBoard as TeamBoardData, type TeamBoardItem } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { resetDragToLane } from '@/features/drag-to-lane';
import { clearToasts, getToasts } from '@/shared/model';
import { RouterProvider, createRouter } from '@/shared/routing';
import { fakeAdoRow, fakeTicketRecord, installFakeSettings } from '@/shared/testing';
import { resetTeamBoardSession } from '@/widgets/team-board';
import { BoardPage } from './BoardPage';

/**
 * AL-220: drag-to-lane and launch-from-ado together on the real board page, against the fake bridge:
 * a team board card sent to a lane goes to `agent:launchFromAdo` as main expects it, the new card lands
 * in its lane, the success toast offers Undo, and Undo goes to `agent:undoLaunch` and takes the card off.
 * (The pointer and keyboard drags themselves are covered by `DragToLane.test.tsx` and the e2e specs.)
 */

vi.setConfig({ testTimeout: 30_000 });

const KR = { id: 'kr', displayName: 'Kyle Richards', uniqueName: null, initials: 'KR' };

function item(id: number, fields: Partial<TeamBoardItem>): TeamBoardItem {
  return {
    id,
    type: 'Bug',
    title: `Item ${id}`,
    state: 'Active',
    points: 2,
    columnId: 'failed',
    column: 'Failed',
    columnKind: 'failed',
    assignee: null,
    branch: null,
    pullRequestId: null,
    webUrl: `https://dev.azure.com/x/_workitems/edit/${id}`,
    ...fields,
  };
}

const BOARD: TeamBoardData = {
  team: { id: 'osc', name: 'OSC Developers' },
  sprint: { id: 's42', name: 'Sprint 42', path: 'OnSite\\Sprint 42' },
  columns: [
    { id: 'todo', name: 'To Do', kind: 'to-do' },
    { id: 'doing', name: 'In Progress', kind: 'in-progress' },
    { id: 'failed', name: 'Failed', kind: 'failed' },
  ],
  items: [item(71318, { state: 'Failed UAT', assignee: KR, title: 'Quote PDF totals round incorrectly' })],
};

const record = fakeTicketRecord({ id: '71318', stage: 'planning' });
const LAUNCHED: LaunchFromAdoResponse = {
  ticketId: '71318',
  record,
  status: { ticketId: '71318', state: 'running', sessionId: null, message: null } as LaunchFromAdoResponse['status'],
  adoChange: { workItemId: 71318, previousAssignee: 'Kyle Richards', previousState: 'Failed UAT', state: 'Active' },
  undoId: 'undo-71318-0123456789abcdef',
  summary: '#71318 moved to In Progress · agent started in Planning',
};

let invoke: ReturnType<typeof installFakeSettings>['bridge']['invoke'];

/** The fake main process; `launch` is its answer to `agent:launchFromAdo`. */
function installMain(launch: unknown = { ok: true, data: LAUNCHED }) {
  const fake = installFakeSettings(defaultSettings(), {
    'connections:list': { ok: true, data: [fakeAdoRow()] },
    'tickets:list': { ok: true, data: [] },
    'ado:listTeams': { ok: true, data: { teams: [BOARD.team], defaultTeamId: 'osc' } },
    'ado:teamBoard': { ok: true, data: BOARD },
    'ado:activePrs': { ok: true, data: { team: BOARD.team, pullRequests: [] } },
    'ado:backlog': { ok: true, data: { team: BOARD.team, total: 0, page: { index: 0, size: 1, count: 0 }, groups: [] } },
    'agent:launchFromAdo': launch,
    'agent:undoLaunch': { ok: true, data: { ticketId: '71318', worktreeRemoved: true, leftovers: [], adoRestored: true, summary: '#71318 is back in Failed UAT · the worktree and agent are gone' } },
  });
  invoke = fake.bridge.invoke;
}

beforeEach(() => {
  resetDragToLane();
  resetTeamBoardSession();
  clearToasts();
  agentTickets.load([]);
  installMain();
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  clearToasts();
  agentTickets.load([]);
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <RouterProvider router={createRouter()}>
        <BoardPage />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

describe('team board launch on the board page (AL-235 + AL-236 + AL-237)', () => {
  it('sends the card to agent:launchFromAdo, shows the new card and Undo, and Undo takes it back', async () => {
    renderPage();
    const card = await screen.findByTestId('team-card-71318');
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByTestId('send-to-lane-planning'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('agent:launchFromAdo', {
        source: { kind: 'board-item', id: 71318, team: 'osc', sprint: 'OnSite\\Sprint 42', column: 'Failed' },
        lane: 'planning',
      }),
    );
    expect(await within(screen.getByTestId('lane-planning')).findByRole('button', { name: /^#71318/ })).toBeTruthy();
    const toast = await vi.waitFor(() => {
      const found = getToasts().find((entry) => entry.id === 'launch-from-ado:71318');
      if (!found) throw new Error('no launch toast yet');
      return found;
    });
    expect(toast).toMatchObject({ tone: 'success', title: 'Agent started in Planning', body: LAUNCHED.summary });

    const undo = toast.actions.find((action) => action.label === 'Undo');
    expect(undo && 'onPress' in undo).toBe(true);
    await act(async () => (undo as { onPress(): void }).onPress());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent:undoLaunch', { undoId: LAUNCHED.undoId }));
    await waitFor(() => expect(within(screen.getByTestId('lane-planning')).queryByRole('button', { name: /^#71318/ })).toBeNull());
    expect(getToasts().find((entry) => entry.id === 'launch-from-ado:71318')).toMatchObject({ title: 'Launch undone' });
  });

  it("says why main refused the drop and starts nothing (\"Moved to Testing — refreshed\")", async () => {
    installMain({ ok: false, code: 'VALIDATION', message: 'Moved to Testing — refreshed', details: { reason: 'moved', column: 'Testing' } });
    renderPage();
    const card = await screen.findByTestId('team-card-71318');
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByTestId('send-to-lane-planning'));
    await waitFor(() => expect(getToasts().find((entry) => entry.id === 'launch-from-ado')).toMatchObject({ title: "The drop didn't start an agent", body: 'Moved to Testing — refreshed' }));
    expect(within(screen.getByTestId('lane-planning')).queryByRole('button', { name: /^#71318/ })).toBeNull();
  });
});
