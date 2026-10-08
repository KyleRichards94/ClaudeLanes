import type { TeamBoard, TeamBoardItem } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, getToasts } from '@/shared/model';
import { resetDragToLane, usePendingDropLanes } from './drag-store';
import type { LaneDragCard } from './types';
import { initialsOf, useDropOnLane, withItemInProgress } from './use-drop';

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

const BOARD: TeamBoard = {
  team: { id: 'osc', name: 'OSC Developers' },
  sprint: { id: 's42', name: 'Sprint 42', path: 'OnSite\\Sprint 42' },
  columns: [
    { id: 'todo', name: 'To Do', kind: 'to-do' },
    { id: 'doing', name: 'In Progress', kind: 'in-progress' },
    { id: 'failed', name: 'Failed', kind: 'failed' },
  ],
  items: [item(71318, { state: 'Failed UAT' }), item(71341, { columnId: 'todo', column: 'To Do', columnKind: 'to-do' })],
};
const KEY = ['ado', 'teamBoard', null, 'OnSite\\Sprint 42'];

/** Artboard 10: Failed item #71318, unassigned, dropped on Planning. */
const FAILED_71318: LaneDragCard = {
  key: 'item:71318',
  label: '#71318',
  title: 'Quote PDF totals round incorrectly',
  card: { kind: 'board-item', id: 71318, column: 'failed', assignee: null, agentLane: null, pullRequestId: null, branch: null },
  me: { id: 'me' },
  meName: 'Kyle Richards',
  source: { kind: 'board-item', id: 71318, team: 'osc', sprint: 'OnSite\\Sprint 42', column: 'Failed' },
};

const PR_10571: LaneDragCard = {
  key: 'pr:10571',
  label: '!10571',
  title: 'Job notes rich text editor',
  card: { kind: 'pull-request', id: 10571, author: { id: 'me', displayName: 'Kyle Richards' }, unresolvedThreads: 6, sourceBranch: 'x', repoRegistered: true },
  me: { id: 'me' },
  meName: 'Kyle Richards',
  source: { kind: 'pull-request', id: 10571, team: 'osc' },
};

let client: QueryClient;

function setup(onLaunch?: Parameters<typeof useDropOnLane>[0]) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => ({ drop: useDropOnLane(onLaunch), pending: usePendingDropLanes() }), { wrapper });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetDragToLane();
  clearToasts();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, BOARD);
});

describe('withItemInProgress', () => {
  it("moves the item to the board's In Progress column, assigned to you; other items are left alone", () => {
    const moved = withItemInProgress(BOARD, 71318, 'Kyle Richards');
    expect(moved.items[0]).toMatchObject({
      columnId: 'doing',
      column: 'In Progress',
      columnKind: 'in-progress',
      assignee: { displayName: 'Kyle Richards', initials: 'KR' },
    });
    expect(moved.items[1]).toBe(BOARD.items[1]);
    expect(withItemInProgress(BOARD, 1, 'Kyle Richards')).toBe(BOARD);
  });

  it('makes initials from the first and last word', () => {
    expect(initialsOf('Kyle Richards')).toBe('KR');
    expect(initialsOf('Mia van der Berg')).toBe('MB');
    expect(initialsOf('Cher')).toBe('C');
  });
});

describe('useDropOnLane (AL-235)', () => {
  it('updates the board optimistically, hands the drop to the launch, and refetches when main confirms', async () => {
    const launch = deferred<unknown>();
    const onLaunch = vi.fn(() => launch.promise);
    const { result } = setup(onLaunch);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    let done!: Promise<boolean>;
    act(() => {
      done = result.current.drop(FAILED_71318, 'planning');
    });
    await vi.waitFor(() => expect(onLaunch).toHaveBeenCalled());

    expect(onLaunch).toHaveBeenCalledWith(
      { source: FAILED_71318.source, lane: 'planning' },
      expect.objectContaining({ alt: false, action: expect.objectContaining({ lane: 'planning', changesAdo: true }) }),
    );
    // Before main answers: "Agent in Planning", and the item is in In Progress, assigned to you (T5).
    expect(result.current.pending).toEqual({ '71318': 'planning' });
    expect(client.getQueryData<TeamBoard>(KEY)?.items[0]).toMatchObject({ columnKind: 'in-progress', assignee: { displayName: 'Kyle Richards' } });

    await act(async () => {
      launch.resolve({ ticketId: '71318' });
      expect(await done).toBe(true);
    });
    expect(result.current.pending).toEqual({});
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['ado', 'teamBoard'],
      ['ado', 'activePrs'],
      ['ado', 'backlog'],
    ]);
  });

  it('rolls the board back when the launch is refused, cancelled or fails', async () => {
    const { result } = setup(vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('boom')));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        expect(await result.current.drop(FAILED_71318, 'implementing')).toBe(false);
      });
      expect(client.getQueryData<TeamBoard>(KEY)?.items[0]).toMatchObject({ columnKind: 'failed', assignee: null });
      expect(result.current.pending).toEqual({});
    }
  });

  it("passes Alt on (the launch sheet), and doesn't move a drop that changes nothing in ADO", async () => {
    const onLaunch = vi.fn().mockResolvedValue({ ticketId: '1' });
    const { result } = setup(onLaunch);
    const before = client.getQueryData(KEY);
    await act(async () => {
      expect(await result.current.drop(PR_10571, 'code-review', { alt: true })).toBe(true);
    });
    expect(onLaunch).toHaveBeenCalledWith({ source: PR_10571.source, lane: 'code-review' }, expect.objectContaining({ alt: true }));
    expect(client.getQueryData(KEY)).toBe(before);
  });

  it('refuses a lane the rules refuse, without calling the launch', async () => {
    const onLaunch = vi.fn();
    const { result } = setup(onLaunch);
    await act(async () => {
      expect(await result.current.drop(PR_10571, 'qa')).toBe(false);
    });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('says so and changes nothing when this build has no launch', async () => {
    const { result } = setup();
    await act(async () => {
      expect(await result.current.drop(FAILED_71318, 'planning')).toBe(false);
    });
    expect(getToasts().map((toast) => toast.title)).toEqual(["Agents can't start from the team board yet"]);
    expect(client.getQueryData<TeamBoard>(KEY)?.items[0]).toMatchObject({ columnKind: 'failed' });
  });
});
