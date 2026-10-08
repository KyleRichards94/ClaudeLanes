import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BacklogRequest } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createAgentTicketStore, type AgentTicketStore } from '@/entities/agent-ticket';
import { DragToLaneProvider, NATIVE_BACKLOG_DRAG_TYPE, decodeNativeBacklogDrag, resetDragToLane, type LaunchFromLane } from '@/features/drag-to-lane';
import { fakeAdoRow, fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { artboard11Page, MD, backlogItem } from '../model/fixtures';
import { resetBacklogSearch } from '../model/session';
import { BacklogPopout, SEARCH_DELAY_MS, type BacklogPopoutProps } from './BacklogPopout';

let bridge: FakeBridge;
let store: AgentTicketStore;
let onLaunch: Mock<LaunchFromLane>;
let onClose: Mock<() => void>;

beforeEach(() => {
  resetDragToLane();
  resetBacklogSearch();
  bridge = installFakeBridge({
    'connections:list': { ok: true, data: [fakeAdoRow()] },
    'ado:backlog': { ok: true, data: artboard11Page() },
  });
  store = createAgentTicketStore();
  onLaunch = vi.fn<LaunchFromLane>().mockResolvedValue({ ticketId: '1' });
  onClose = vi.fn();
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPopout(props: Partial<BacklogPopoutProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (extra: Partial<BacklogPopoutProps> = {}) => (
    <QueryClientProvider client={client}>
      <DragToLaneProvider onLaunch={onLaunch}>
        <BacklogPopout visible teamId={null} onClose={onClose} store={store} {...props} {...extra} />
      </DragToLaneProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  return { ...view, rerenderWith: (extra: Partial<BacklogPopoutProps>) => view.rerender(element(extra)) };
}

/** The `ado:backlog` requests made so far. */
function backlogRequests(): BacklogRequest[] {
  return vi
    .mocked(bridge.invoke)
    .mock.calls.filter(([channel]) => channel === 'ado:backlog')
    .map(([, request]) => request as BacklogRequest);
}

const row = (id: number) => screen.getByTestId(`backlog-row-${id}`);

describe('Backlog popout (AL-239, TB§5, artboard 11)', () => {
  it("shows the profile team's backlog grouped by Feature, with each row's id, type, title, tag, points and priority", async () => {
    renderPopout();
    expect(await screen.findByText('Bulk reassign jobs between technicians')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Backlog' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
    expect(screen.getByTestId('backlog-popout-subtitle').textContent).toBe('OSC Developers · 48 items · unassigned items can be dragged onto Planning or Implementing');
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Job management', 'Client portal', 'Timesheets']);
    const lists = screen.getAllByRole('list');
    expect(lists.map((list) => within(list).getAllByRole('listitem').length)).toEqual([3, 3, 1]);
    expect(row(71360).textContent).toContain('#71360');
    expect(row(71360).textContent).toContain('Story');
    expect(row(71360).textContent).toContain('jobs');
    expect(row(71360).textContent).toContain('5 pts');
    expect(row(71362).textContent).toContain('Bug');
    expect(row(71384).textContent).toContain('Task');
    // A row that can be dragged is a draggable button that opens "Send to lane".
    expect(row(71360).getAttribute('aria-roledescription')).toBe('draggable card');
    expect(backlogRequests()[0]).toEqual({ filters: {}, page: { index: 0, size: 50 } });
    expect(screen.getByLabelText('Search the backlog').getAttribute('placeholder')).toBe('Search by ID, title or tag');
  });

  it('asks Azure DevOps again once typing pauses, and for the type picked', async () => {
    renderPopout();
    await screen.findByText('Bulk reassign jobs between technicians');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByLabelText('Search the backlog'), { target: { value: 'reassign' } });
    expect(backlogRequests()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);
    });
    await waitFor(() => expect(backlogRequests().at(-1)?.filters).toEqual({ text: 'reassign' }));
    vi.useRealTimers();

    fireEvent.click(within(screen.getByTestId('backlog-kind')).getByRole('radio', { name: 'Bug' }));
    await waitFor(() => expect(backlogRequests().at(-1)?.filters).toEqual({ text: 'reassign', kinds: ['bug'] }));
    fireEvent.click(screen.getByRole('switch', { name: /In a sprint/ }));
    await waitFor(() => expect(backlogRequests().at(-1)?.filters).toEqual({ text: 'reassign', kinds: ['bug'], includeInSprint: true }));
  });

  it('remembers search and filters for the session', async () => {
    const view = renderPopout();
    await screen.findByText('Bulk reassign jobs between technicians');
    fireEvent.click(within(screen.getByTestId('backlog-kind')).getByRole('radio', { name: 'Story' }));
    view.rerenderWith({ visible: false });
    expect(screen.queryByTestId('backlog-popout')).toBeNull();
    view.rerenderWith({ visible: true });
    await screen.findByText('Bulk reassign jobs between technicians');
    expect(within(screen.getByTestId('backlog-kind')).getByRole('radio', { name: 'Story' }).getAttribute('aria-checked')).toBe('true');
    expect(backlogRequests().at(-1)?.filters).toEqual({ kinds: ['story'] });
  });

  it('closes with Escape, the close button and a click outside it', async () => {
    renderPopout();
    await screen.findByText('Bulk reassign jobs between technicians');
    fireEvent.keyDown(screen.getByLabelText('Search the backlog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close the backlog' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('backlog-popout-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
    // Wherever focus is: after a pointer drop it is on the page, not in the popout.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('offers Pop out when the host can open the backlog in its own window', async () => {
    const onPopOut = vi.fn();
    renderPopout({ onPopOut });
    fireEvent.click(await screen.findByRole('button', { name: 'Pop out' }));
    expect(onPopOut).toHaveBeenCalled();
  });

  it('selects rows with a click and a range with shift-click, and Clear empties the selection (artboard 12)', async () => {
    renderPopout();
    await screen.findByText('Bulk reassign jobs between technicians');
    fireEvent.click(screen.getByTestId('backlog-row-71360-select'));
    fireEvent.click(screen.getByTestId('backlog-row-71335-select'), { shiftKey: true });
    expect(screen.getByTestId('backlog-selection').textContent).toContain('4 selected · drag any of them to start one agent each');
    expect(screen.getByTestId('backlog-row-71371-select').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('backlog-row-71377-select').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('backlog-row-71371-select'));
    expect(screen.getByTestId('backlog-selection').textContent).toContain('3 selected');
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByTestId('backlog-selection')).toBeNull();
  });

  it('sends every selected row to Planning from the keyboard menu: one agent each (TB§5)', async () => {
    renderPopout();
    await screen.findByText('Bulk reassign jobs between technicians');
    fireEvent.click(screen.getByTestId('backlog-row-71360-select'));
    fireEvent.click(screen.getByTestId('backlog-row-71335-select'));
    act(() => row(71335).focus());
    fireEvent.keyDown(row(71335), { key: 'Enter', code: 'Enter' });
    const menu = await screen.findByRole('menu', { name: 'Send 2 items to a lane' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Planning: plan it\./),
      expect.stringMatching(/^Implementing: implement it\./),
    ]);
    expect(menu.textContent).toContain('Plan these');
    fireEvent.click(screen.getByTestId('send-to-lane-planning'));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(2));
    expect(onLaunch.mock.calls.map(([drop]) => drop)).toEqual([
      { source: { kind: 'backlog-item', id: 71360 }, lane: 'planning' },
      { source: { kind: 'backlog-item', id: 71335 }, lane: 'planning' },
    ]);
  });

  it("locks someone else's row and keeps an \"Agent in Planning\" tag on a row with an agent", async () => {
    bridge = installFakeBridge({
      'connections:list': { ok: true, data: [fakeAdoRow()] },
      'ado:backlog': {
        ok: true,
        data: artboard11Page({ groups: [{ feature: null, items: [backlogItem(71400, { assignee: MD }), backlogItem(71360)] }] }),
      },
    });
    store.upsert(fakeTicketRecord({ id: '71360', stage: 'planning', ado: { org: 'ado:x', project: 'OnSite', workItemId: 71360, title: 'x', url: 'https://dev.azure.com/x' } } as never));
    renderPopout();
    expect(await screen.findByTestId('backlog-row-71400-lock')).toBeTruthy();
    expect(screen.getByTestId('backlog-row-71400-lock').textContent).toContain('Assigned to Mark Davies');
    expect(row(71400).getAttribute('role')).toBe('listitem');
    expect(screen.getByTestId('backlog-row-71400-select').getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => expect(screen.getByTestId('backlog-row-71360-agent').textContent).toContain('Agent in Planning'));
  });

  it('fades to 35 % and lets the pointer through while a row is dragged', async () => {
    renderPopout();
    await screen.findByText('Bulk reassign jobs between technicians');
    const layer = screen.getByTestId('backlog-popout');
    expect(getComputedStyle(layer).opacity).not.toBe('0.35');
    act(() => row(71360).focus());
    fireEvent.keyDown(row(71360), { code: 'Space', key: ' ' });
    await waitFor(() => expect(getComputedStyle(layer).opacity).toBe('0.35'));
    expect(getComputedStyle(layer).pointerEvents).toBe('none');
    // Escape cancels the drag, not the popout.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    await waitFor(() => expect(getComputedStyle(layer).opacity).not.toBe('0.35'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('in its own window, makes rows native drag sources carrying the selected rows', async () => {
    renderPopout({ mode: 'window' });
    await screen.findByText('Bulk reassign jobs between technicians');
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull();
    expect(screen.queryByTestId('backlog-popout-backdrop')).toBeNull();
    fireEvent.click(screen.getByTestId('backlog-row-71360-select'));
    fireEvent.click(screen.getByTestId('backlog-row-71362-select'));
    const source = row(71362);
    expect(source.getAttribute('draggable')).toBe('true');
    const data = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), effectAllowed: 'none' };
    fireEvent.dragStart(source, { dataTransfer });
    const card = decodeNativeBacklogDrag(data.get(NATIVE_BACKLOG_DRAG_TYPE) ?? '');
    expect(card?.group?.map((member) => member.source.id)).toEqual([71360, 71362]);
    expect(data.get('text/plain')).toContain('#71362 Job search ignores archived clients filter');
    expect(dataTransfer.effectAllowed).toBe('copy');
  });
});
