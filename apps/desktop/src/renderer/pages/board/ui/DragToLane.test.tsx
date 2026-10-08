import { LANES, defaultSettings, type ActivePullRequestList, type TeamBoard as TeamBoardData, type TeamBoardItem } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createAgentTicketStore, type AgentTicketStore } from '@/entities/agent-ticket';
import { DragToLaneProvider, resetDragToLane, type LaunchFromLane } from '@/features/drag-to-lane';
import { useUiPrefs } from '@/shared/model';
import { RouterProvider, createRouter } from '@/shared/routing';
import { fakeAdoRow, installFakeSettings } from '@/shared/testing';
import { TeamBoard, resetTeamBoardSession } from '@/widgets/team-board';
import { BoardLanes } from './BoardLanes';

/**
 * AL-235 on the board: the team board's cards go to the agent lanes by keyboard drag (dnd-kit's
 * keyboard sensor) and by the "Send to lane" menu. jsdom has no layout, so lanes and cards get rects
 * from their test ids: lanes 220 px apart along the top, cards under them.
 */

const KR = { id: 'kr', displayName: 'Kyle Richards', uniqueName: null, initials: 'KR' };
const MD = { id: 'md', displayName: 'Mark Davies', uniqueName: null, initials: 'MD' };

function item(id: number, fields: Partial<TeamBoardItem>): TeamBoardItem {
  return {
    id,
    type: 'Bug',
    title: `Item ${id}`,
    state: 'Active',
    points: 3,
    columnId: 'todo',
    column: 'To Do',
    columnKind: 'to-do',
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
    { id: 'review', name: 'Code Review', kind: 'code-review' },
    { id: 'failed', name: 'Failed', kind: 'failed' },
  ],
  items: [
    item(71341, { assignee: MD }),
    item(71300, { columnId: 'review', column: 'Code Review', columnKind: 'code-review' }),
    item(71318, { columnId: 'failed', column: 'Failed', columnKind: 'failed', state: 'Failed UAT', assignee: KR, title: 'Quote PDF totals round incorrectly' }),
  ],
};

const PRS: ActivePullRequestList = {
  team: BOARD.team,
  pullRequests: [
    {
      id: 10571,
      title: 'Job notes rich text editor',
      isDraft: false,
      author: KR,
      reviewers: [],
      sourceBranch: '71240-job-notes-editor',
      targetBranch: 'main',
      repository: { id: 'r', name: 'onsite-companion', projectId: 'p', projectName: 'OnSite' },
      createdAt: '2026-10-07T03:00:00.000Z',
      unresolvedThreads: 6,
      repoRegistered: true,
      webUrl: 'https://dev.azure.com/x/_git/r/pullrequest/10571',
    },
  ],
};

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

const originalRect = Element.prototype.getBoundingClientRect;
let store: AgentTicketStore;
let onLaunch: Mock<LaunchFromLane>;

beforeEach(() => {
  resetDragToLane();
  resetTeamBoardSession();
  installFakeSettings(defaultSettings(), {
    'connections:list': { ok: true, data: [fakeAdoRow()] },
    'ado:listTeams': { ok: true, data: { teams: [BOARD.team], defaultTeamId: 'osc' } },
    'ado:teamBoard': { ok: true, data: BOARD },
    'ado:activePrs': { ok: true, data: PRS },
    'ado:backlog': { ok: true, data: { team: BOARD.team, total: 0, page: { index: 0, size: 1, count: 0 }, groups: [] } },
  });
  useUiPrefs.setState({ collapsedLanes: ['done'] });
  store = createAgentTicketStore();
  onLaunch = vi.fn<LaunchFromLane>().mockResolvedValue({ ticketId: '1' });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const id = this.getAttribute('data-testid') ?? '';
    const lane = LANES.findIndex((name) => id === `lane-${name}`);
    if (lane !== -1) return rect(lane * 220, 100, 200, 400);
    if (/^team-(pr|card)-\d+$/.test(id)) return rect(1000, 700, 200, 100);
    // dnd-kit measures the drag overlay by its only child, the preview, once: where the card was.
    if (id === 'drag-preview') return rect(1000, 700, 200, 100);
    return rect(0, 0, 0, 0);
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

async function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createRouter()}>
        <DragToLaneProvider onLaunch={onLaunch}>
          <BoardLanes store={store} />
          <TeamBoard sprintPath={BOARD.sprint.path} store={store} />
        </DragToLaneProvider>
      </RouterProvider>
    </QueryClientProvider>,
  );
  return screen.findByTestId('team-pr-10571');
}

/** dnd-kit's own live region, where it announces drags. */
function dndAnnouncement(): string {
  return document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
}

/** The keyboard sensor listens on the document from the next tick after pick-up. */
async function nextTick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const hint = (lane: string) => screen.queryByTestId(`lane-${lane}-drop-hint`);

describe('drag to lane (AL-235)', () => {
  it('lights Implementing and Code review only while PR !10571 is picked up with Space, and announces each lane (artboard 09)', async () => {
    const card = await renderBoard();
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('aria-roledescription')).toBe('draggable card');

    act(() => card.focus());
    fireEvent.keyDown(card, { code: 'Space', key: ' ' });
    await nextTick();

    expect(hint('implementing')?.textContent).toContain('Answer PR comments');
    expect(hint('code-review')?.textContent).toContain('Review this PR');
    for (const lane of ['queued', 'planning', 'qa', 'create-pr']) expect(hint(lane)).toBeNull();
    // Lit lanes change border style as well as colour; the others fade.
    expect(getComputedStyle(screen.getByTestId('lane-implementing')).borderStyle).toBe('dashed');
    expect(getComputedStyle(screen.getByTestId('lane-planning')).opacity).toBe('0.45');
    await waitFor(() => expect(dndAnnouncement()).toContain('Picked up !10571. Implementing and Code review take it.'));

    fireEvent.keyDown(document, { code: 'ArrowRight', key: 'ArrowRight' });
    await waitFor(() => expect(dndAnnouncement()).toBe('Over Implementing: answer 6 comments'));
    expect(getComputedStyle(screen.getByTestId('lane-implementing')).borderStyle).toBe('solid');

    fireEvent.keyDown(document, { code: 'ArrowRight', key: 'ArrowRight' });
    await waitFor(() => expect(dndAnnouncement()).toBe('Over Code review: start agentic review'));

    fireEvent.keyDown(document, { code: 'Space', key: ' ' });
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(onLaunch).toHaveBeenCalledWith(
      { source: { kind: 'pull-request', id: 10571, team: 'osc' }, lane: 'code-review' },
      expect.objectContaining({ alt: false, action: expect.objectContaining({ label: 'start agentic review' }) }),
    );
    expect(dndAnnouncement()).toBe('Dropped !10571 on Code review: start agentic review');
    expect(hint('code-review')).toBeNull();
  });

  it('Escape cancels a keyboard drag without launching anything', async () => {
    const card = await renderBoard();
    act(() => card.focus());
    fireEvent.keyDown(card, { code: 'Space', key: ' ' });
    await nextTick();
    fireEvent.keyDown(document, { code: 'ArrowRight', key: 'ArrowRight' });
    await waitFor(() => expect(dndAnnouncement()).toBe('Over Implementing: answer 6 comments'));
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    await waitFor(() => expect(dndAnnouncement()).toBe('Cancelled. !10571 is back in its column.'));
    expect(hint('implementing')).toBeNull();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('Enter opens "Send to lane" with only the lanes that take the card, and sending one is announced', async () => {
    const card = await renderBoard();
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    const menu = await screen.findByRole('menu', { name: 'Send !10571 to a lane' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((entry) => entry.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Implementing: answer 6 comments\./),
      expect.stringMatching(/^Code review: start agentic review\./),
    ]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.click(items[0]!);
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith({ source: { kind: 'pull-request', id: 10571, team: 'osc' }, lane: 'implementing' }, expect.anything()));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('drag-to-lane-announcement')?.textContent).toContain('Sent !10571 to Implementing: answer 6 comments');
  });

  it('shows "Agent in Planning" on a dropped item straight away, before main confirms', async () => {
    let confirm!: (value: unknown) => void;
    onLaunch.mockReturnValue(new Promise((resolve) => (confirm = resolve)));
    await renderBoard();
    const card = screen.getByTestId('team-card-71318');
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByTestId('send-to-lane-planning'));

    await waitFor(() => expect(screen.getByTestId('team-card-71318-agent')?.textContent).toContain('Agent in Planning'));
    // An item with an agent can't be dragged again.
    expect(screen.getByTestId('team-card-71318').getAttribute('role')).not.toBe('button');
    await act(async () => confirm({ ticketId: '71318' }));
  });

  it('lets a Code Review item with no linked PR be picked up, and Code review says "No linked PR"', async () => {
    await renderBoard();
    const card = screen.getByTestId('team-card-71300');
    act(() => card.focus());
    fireEvent.keyDown(card, { code: 'Space', key: ' ' });
    await nextTick();
    expect(screen.getByTestId('lane-code-review-drop-refusal')?.textContent).toContain('No linked PR');
    expect(screen.queryByTestId('lane-code-review-drop-hint')).toBeNull();
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
  });

  it("leaves someone else's item a plain list item: no drag, no menu", async () => {
    await renderBoard();
    const locked = screen.getByTestId('team-card-71341');
    expect(locked.getAttribute('role')).toBe('listitem');
    expect(locked.hasAttribute('tabindex')).toBe(false);
  });
});
