import type { TicketRecord } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketStore, type AgentTicketStore } from '@/entities/agent-ticket';
import { RouterProvider, createRouter, selectRoute, type Router } from '@/shared/routing';
import { fakeTicketRecord, installFakeSettings } from '@/shared/testing';
import { AgentBoardStrip } from './AgentBoardStrip';

const BOARD: readonly TicketRecord[] = [
  fakeTicketRecord({ id: '71330', stage: 'queued', stageEnteredAt: 100 }),
  ...['71273', '71288', '71290', '71291', '71292'].map((id, index) => fakeTicketRecord({ id, stage: 'implementing', stageEnteredAt: 110 + index })),
  fakeTicketRecord({ id: 'local-1', stage: 'qa', stageEnteredAt: 200, ado: null }),
];

let store: AgentTicketStore;
let router: Router;

function renderStrip(visible: boolean, onExpand = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <AgentBoardStrip visible={visible} onExpand={onExpand} store={store} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { onExpand, view };
}

beforeEach(() => {
  installFakeSettings();
  store = createAgentTicketStore();
  store.load(BOARD);
  router = createRouter();
});

describe('AgentBoardStrip', () => {
  it('shows one cell per lane with its count and its cards as chips, +N past three', () => {
    renderStrip(true);
    expect(screen.getAllByRole('button', { name: /Show the agent board$/ })).toHaveLength(8);

    const implementing = screen.getByTestId('strip-lane-implementing');
    expect(within(implementing).getByRole('button', { name: 'Implementing, 5 tickets. Show the agent board' })).toBeTruthy();
    expect(within(implementing).getAllByRole('button', { name: /^Open / }).map((chip) => chip.textContent)).toEqual(['#71273', '#71288', '#71290']);
    expect(within(implementing).getByTestId('strip-lane-implementing-more').textContent).toBe('+2');

    // A ticket without a work item shows its own id; an empty lane has no chips.
    expect(within(screen.getByTestId('strip-lane-qa')).getByTestId('strip-chip-local-1').textContent).toBe('local-1');
    expect(within(screen.getByTestId('strip-lane-planning')).queryAllByRole('button', { name: /^Open / })).toHaveLength(0);
  });

  it('turns a lane amber, in words too, when a card in it needs the user', () => {
    act(() => store.setNeedsYou('71330', { kind: 'permission', tool: 'Bash', since: 300 }));
    renderStrip(true);
    expect(screen.getByRole('button', { name: 'Queued, 1 ticket, 1 needs you. Show the agent board' })).toBeTruthy();
  });

  it('expands from a lane cell or the expand button, and opens a ticket from its chip', () => {
    const { onExpand } = renderStrip(true);
    fireEvent.click(screen.getByTestId('strip-lane-qa-head'));
    fireEvent.click(screen.getByTestId('agent-board-strip-expand'));
    expect(onExpand).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('strip-chip-71288'));
    expect(selectRoute(router.getState())).toEqual({ name: 'ticket', ticketId: '71288' });
  });

  it('makes each lane cell a focusable native button, so Enter expands the board (the e2e presses it)', () => {
    renderStrip(true);
    const head = screen.getByTestId('strip-lane-implementing-head');
    expect(head.tagName).toBe('BUTTON');
    head.focus();
    expect(document.activeElement).toBe(head);
  });

  it('is hidden from sight, pointer and screen readers until the board has scrolled past the lanes', () => {
    renderStrip(false);
    const strip = screen.getByTestId('agent-board-strip');
    expect(strip.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(strip).visibility).toBe('hidden');
    expect(getComputedStyle(strip).opacity).toBe('0');
  });

  it('eases in over 220 ms', () => {
    renderStrip(true);
    const strip = getComputedStyle(screen.getByTestId('agent-board-strip'));
    expect(strip.visibility).toBe('visible');
    expect(strip.transitionDuration).toBe('220ms');
    expect(strip.transitionProperty).toContain('opacity');
  });
});
