import type { TicketRecord } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { color, tone } from '@agent-lanes/tokens';
import { createAgentTicketStore, type AgentTicketStore } from '@/entities/agent-ticket';
import { useUiPrefs } from '@/shared/model';
import { RouterProvider, createRouter, selectRoute, type Router } from '@/shared/routing';
import { fakeTicketRecord, installFakeSettings, type FakeSettings } from '@/shared/testing';
import { BoardLanes, LANES_MIN_WIDTH } from './BoardLanes';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Artboard 1: one card per lane, two in Implementing, nothing in Done yet. */
const BOARD: readonly TicketRecord[] = [
  fakeTicketRecord({ id: '71330', stage: 'queued', stageEnteredAt: 100, title: 'Asset register paging slow above 5k rows' }),
  fakeTicketRecord({ id: '71322', stage: 'planning', stageEnteredAt: 110, title: 'Add PO number to invoice print layout' }),
  fakeTicketRecord({ id: '71273', stage: 'implementing', stageEnteredAt: 120 }),
  fakeTicketRecord({ id: '71288', stage: 'implementing', stageEnteredAt: 130, title: 'Job grid filter drops date range' }),
  fakeTicketRecord({ id: '71301', stage: 'code-review', stageEnteredAt: 140, title: 'Defect request accept modal' }),
  fakeTicketRecord({ id: '71266', stage: 'create-pr', stageEnteredAt: 160, title: 'Supplier portal login redirect loop' }),
];

let store: AgentTicketStore;
let router: Router;
let settings: FakeSettings;

function renderLanes() {
  // A waiting gate shows Approve / Request changes under its card (AL-171), which talk to main.
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router}>
        <BoardLanes store={store} />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

const laneHeader = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  settings = installFakeSettings();
  useUiPrefs.setState({ collapsedLanes: ['done'] });
  store = createAgentTicketStore();
  store.load(BOARD);
  router = createRouter();
});

describe('BoardLanes', () => {
  it('shows the six stage lanes in order with their counts, then Done collapsed to a strip', () => {
    renderLanes();

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Queued',
      'Planning',
      'Implementing',
      'Code review',
      'QA',
      'Create PR',
    ]);
    expect(laneHeader(/^Implementing, 2 tickets\. Collapse lane$/)).toBeTruthy();
    expect(laneHeader(/^Queued, 1 ticket\. Collapse lane$/)).toBeTruthy();

    const done = screen.getByTestId('lane-done');
    expect(done.getAttribute('aria-expanded')).toBe('false');
    expect(within(done).getByText('0')).toBeTruthy();
    expect(within(done).getByText('Done · merged this sprint')).toBeTruthy();

    // Cards sit in their lanes, oldest entry first.
    const implementing = within(screen.getByTestId('lane-implementing'));
    expect(implementing.getAllByRole('button', { name: /^#\d+/ }).map((card) => card.getAttribute('aria-label')?.split(',')[0])).toEqual([
      '#71273',
      '#71288',
    ]);
  });

  it('turns the count badge amber while a card in the lane needs the user', () => {
    renderLanes();
    const badge = () => within(screen.getByTestId('lane-code-review')).getByRole('img');
    expect(badge().getAttribute('aria-label')).toBe('1 ticket');
    expect(getComputedStyle(badge()).backgroundColor).toBe(rgb(color.surface));

    act(() => store.openGate('71301', 'code-review', 1_000));
    expect(badge().getAttribute('aria-label')).toBe('1 ticket, 1 needs you');
    expect(getComputedStyle(badge()).backgroundColor).toBe(rgb(tone.attention.band));
  });

  it('shows the empty-lane copy in a lane with no cards', () => {
    renderLanes();
    const qa = within(screen.getByTestId('lane-qa-empty'));
    expect(qa.getByText('Nothing in QA')).toBeTruthy();
    expect(qa.getByText('Tickets land here once code review passes.')).toBeTruthy();
    expect(screen.queryByTestId('lane-implementing-empty')).toBeNull();
  });

  it('moves a card when its ticket changes lane', () => {
    renderLanes();
    act(() => store.setStage('71301', 'qa', 2_000));
    expect(within(screen.getByTestId('lane-qa')).getByRole('button', { name: /^#71301/ })).toBeTruthy();
    expect(screen.getByTestId('lane-code-review-empty')).toBeTruthy();
  });

  it('expands and collapses lanes and saves the choice with the UI prefs', async () => {
    renderLanes();

    fireEvent.click(screen.getByRole('button', { name: /^Done · merged this sprint, 0 tickets\. Expand lane$/ }));
    expect(screen.getByRole('heading', { name: 'Done' })).toBeTruthy();
    expect(useUiPrefs.getState().collapsedLanes).toEqual([]);

    fireEvent.click(laneHeader(/^Planning, 1 ticket\. Collapse lane$/));
    expect(screen.queryByRole('heading', { name: 'Planning' })).toBeNull();
    expect(screen.getByTestId('lane-planning').getAttribute('aria-expanded')).toBe('false');
    expect(useUiPrefs.getState().collapsedLanes).toEqual(['planning']);

    await act(async () => undefined);
    expect(settings.settings.ui.collapsedLanes).toEqual(['planning']);
  });

  it('opens the drill-in when a card is pressed', () => {
    renderLanes();
    fireEvent.click(screen.getByRole('button', { name: /^#71288/ }));
    expect(selectRoute(router.getState())).toEqual({ name: 'ticket', ticketId: '71288' });
  });

  it('keeps a minimum width so a narrow window scrolls sideways', () => {
    renderLanes();
    const row = screen.getByTestId('board-lanes').firstElementChild as HTMLElement;
    expect(getComputedStyle(row).minWidth).toBe(`${LANES_MIN_WIDTH}px`);
  });
});
