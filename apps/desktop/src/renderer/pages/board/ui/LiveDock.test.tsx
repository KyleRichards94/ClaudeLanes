import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { color, tone } from '@agent-lanes/tokens';
import { createAgentTicketStore, type AgentTicketStore } from '@/entities/agent-ticket';
import { RouterProvider, createRouter, selectRoute, type Router } from '@/shared/routing';
import { fakeTicketRecord } from '@/shared/testing';
import { LiveDock } from './LiveDock';

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

let store: AgentTicketStore;
let router: Router;
let renders = 0;
const onRender: ProfilerOnRenderCallback = (_id, phase) => {
  if (phase !== 'mount') renders += 1;
};

function renderDock() {
  const view = render(
    <RouterProvider router={router}>
      <Profiler id="dock" onRender={onRender}>
        <LiveDock store={store} />
      </Profiler>
    </RouterProvider>,
  );
  // The first frame catches up with the store.
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  renders = 0;
  return view;
}

const at = (hours: number, minutes: number) => new Date(2026, 9, 7, hours, minutes).getTime();
const TICKETS = ['71273', '71288', '71310', '71301'] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  store = createAgentTicketStore();
  store.load([
    fakeTicketRecord({ id: '71273' }),
    fakeTicketRecord({ id: '71288' }),
    fakeTicketRecord({ id: '71310', stage: 'qa' }),
    fakeTicketRecord({ id: '71301', stage: 'code-review' }),
  ]);
  router = createRouter();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveDock', () => {
  it('shows the latest three events with their times, amber when a ticket needs the user', () => {
    renderDock();
    expect(screen.getByText('Agent events show here as they happen.')).toBeTruthy();

    act(() => {
      store.setActivity('71288', { text: 'running dotnet test' }, at(14, 1));
      store.setActivity('71301', { text: 'review found 2 issues' }, at(14, 3));
      store.setNeedsYou('71310', { kind: 'qa-gap', gaps: 1, since: at(14, 5) });
      store.setActivity('71273', { text: 'razor-writer committed 3 files' }, at(14, 6));
      vi.advanceTimersToNextFrame();
    });

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      '14:06 #71273 razor-writer committed 3 files. Open ticket',
      '14:05 #71310 Needs you · 1 gap. Open ticket',
      '14:03 #71301 review found 2 issues. Open ticket',
    ]);
    expect(getComputedStyle(screen.getByText('14:05').parentElement as HTMLElement).color).toBe(rgb(tone.attention.text));
    expect(getComputedStyle(screen.getByText('14:06').parentElement as HTMLElement).color).toBe(rgb(color.ink));
  });

  it('counts running sub-agents and builds', () => {
    renderDock();
    act(() => {
      store.setSubAgentCounts('71273', { queued: 1, running: 3, done: 0, failed: 0 });
      store.setSubAgentCounts('71288', { queued: 0, running: 4, done: 2, failed: 0 });
      store.applyBuildJob({ ticketId: '71288', jobId: 'b1', kind: 'build', state: 'running', position: null });
      vi.advanceTimersToNextFrame();
    });
    expect(screen.getByTestId('live-dock-sub-agents').textContent).toBe('Sub-agents 7');
    expect(screen.getByTestId('live-dock-builds').textContent).toBe('Builds 1');
  });

  it('updates no more than once per frame under load', () => {
    renderDock();

    for (let frame = 0; frame < 5; frame += 1) {
      act(() => {
        for (let i = 0; i < 400; i += 1) {
          const ticket = TICKETS[i % TICKETS.length] ?? '71273';
          store.setActivity(ticket, { text: `step ${frame}-${i}`, progress: i / 400 }, at(14, 0) + frame * 1_000 + i);
          store.setSubAgentCounts(ticket, { queued: 0, running: i % 5, done: 0, failed: 0 });
        }
      });
      // Nothing re-renders inside the frame, however many commits the store took.
      expect(renders).toBe(frame);
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(renders).toBe(frame + 1);
    }
    expect(screen.getAllByRole('link')[0]?.getAttribute('aria-label')).toContain('step 4-399');
  });

  it('opens the ticket of an event when it is pressed', () => {
    renderDock();
    act(() => {
      store.setActivity('71310', { text: 'export exceeds 30s' }, at(14, 5));
      vi.advanceTimersToNextFrame();
    });
    fireEvent.click(screen.getByRole('link', { name: /#71310 export exceeds 30s/ }));
    expect(selectRoute(router.getState())).toEqual({ name: 'ticket', ticketId: '71310' });
  });
});
