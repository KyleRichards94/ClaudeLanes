import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { color, mutedOpacity, tone } from '@agent-lanes/tokens';
import { fakeTicketRecord } from '@/shared/testing';
import { createAgentTicketStore, type AgentTicketStore } from '../model/store';
import { AgentTicketCard } from './AgentTicketCard';
import { cardView, needsYouLabel, type CardState } from './card-view';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const ID = '71273';

/** One ticket in Implementing, Opus · XHigh, 3 sub-agents, "Editing JobControl.razor" at 45 % (artboard 6 "Running"). */
function runningStore(): AgentTicketStore {
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: ID })]);
  store.setActivity(ID, { text: 'Editing JobControl.razor', progress: 0.45 }, 3_000);
  store.setSubAgentCounts(ID, { queued: 0, running: 2, done: 1, failed: 0 });
  return store;
}

/**
 * Every state on artboard 6 (docs/design/screens/06-card-states.png), plus Queued and Needs
 * permission, each reached through the store actions the main-process events drive (AL-141).
 */
const STATES: {
  name: string;
  state: CardState;
  setup: (store: AgentTicketStore) => void;
  activity: string;
  footer?: string;
  border: string;
  model?: string;
  subAgents?: string;
}[] = [
  { name: 'Running', state: 'running', setup: () => undefined, activity: 'Editing JobControl.razor', border: color.line, model: 'Opus · XHigh', subAgents: '3 sub-agents' },
  {
    name: 'Needs approval',
    state: 'needs-you',
    setup: (store) => {
      store.setActivity(ID, { text: 'Plan ready for review', progress: 1 }, 3_100);
      store.openGate(ID, 'planning', 3_200);
    },
    activity: 'Plan ready for review',
    footer: 'Needs you · approve plan',
    border: tone.attention.border,
  },
  {
    name: 'Model switching',
    state: 'switching',
    setup: (store) => {
      store.setActivity(ID, { text: 'Finishing current turn' }, 3_100);
      store.requestModelChange(ID, { model: 'sonnet', effort: 'high' }, 3_200);
    },
    activity: 'Finishing current turn',
    footer: 'Switching · applies next turn',
    border: color.line,
    model: 'Opus → Sonnet · High',
  },
  {
    name: 'Build failed',
    state: 'build-failed',
    setup: (store) => {
      store.setActivity(ID, { text: 'CS0246: JobFilterState not found' }, 3_100);
      store.setLastBuild(ID, { outcome: 'failed', startedAt: 3_000, finishedAt: 3_200, errors: 3, warnings: 0 });
    },
    activity: 'CS0246: JobFilterState not found',
    footer: 'Build failed · 3 errors',
    border: tone.danger.border,
  },
  {
    name: 'QA gap',
    state: 'needs-you',
    setup: (store) => {
      store.setStage(ID, 'qa', 3_100);
      store.setActivity(ID, { text: 'cs-qa-wip: 4 / 5 criteria pass', progress: 0.8 }, 3_200);
      store.setNeedsYou(ID, { kind: 'qa-gap', gaps: 1, since: 3_300 });
    },
    activity: 'cs-qa-wip: 4 / 5 criteria pass',
    footer: 'Needs you · 1 gap',
    border: tone.attention.border,
  },
  {
    name: 'PR open',
    state: 'pr-open',
    setup: (store) => {
      store.setStage(ID, 'create-pr', 3_100);
      store.setPullRequest(ID, { id: 10612, status: 'active', checks: { passed: 3, total: 4, pending: 1 } });
    },
    activity: 'PR !10612 · 3 / 4 checks',
    border: color.line,
  },
  {
    name: 'Merged',
    state: 'merged',
    setup: (store) => store.setStage(ID, 'done', new Date(2026, 9, 7, 15, 20).getTime()),
    activity: 'Merged into main · 15:20',
    border: color.line,
    subAgents: '—',
  },
  {
    name: 'Queued',
    state: 'queued',
    setup: (store) => store.setStage(ID, 'queued', 3_100),
    activity: 'Waiting for a free slot',
    border: color.line,
  },
  {
    name: 'Needs permission',
    state: 'needs-you',
    setup: (store) => store.setNeedsYou(ID, { kind: 'permission', tool: 'Bash', since: 3_100 }),
    activity: 'Editing JobControl.razor',
    footer: 'Needs you · allow Bash',
    border: tone.attention.border,
  },
];

describe('AgentTicketCard', () => {
  it.each(STATES)('shows the $name state', ({ state, setup, activity, footer, border, model, subAgents }) => {
    const store = runningStore();
    act(() => setup(store));
    render(<AgentTicketCard ticketId={ID} store={store} adoState="Active" testID="ticket" />);

    expect(cardView(store.getState().byId.get(ID)!).state).toBe(state);
    expect(screen.getByText('#71273')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Cutover frmJobControl to Blazor')).toBeTruthy();
    expect(screen.getByText(activity)).toBeTruthy();
    if (model) expect(screen.getByText(model)).toBeTruthy();
    if (subAgents) expect(screen.getByText(subAgents)).toBeTruthy();

    const card = screen.getByTestId('ticket-card');
    expect(getComputedStyle(card).borderTopColor).toBe(rgb(border));
    expect(getComputedStyle(card).opacity).toBe(state === 'merged' ? String(mutedOpacity) : '1');
    if (footer) {
      const band = screen.getByTestId('ticket-card-footer');
      expect(band.textContent).toBe(footer);
    } else {
      expect(screen.queryByTestId('ticket-card-footer')).toBeNull();
    }
    // The bar is announced with the stage, never colour alone.
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toMatch(/progress$/);
  });

  it('shows the violet outline when selected', () => {
    render(<AgentTicketCard ticketId={ID} store={runningStore()} selected testID="ticket" />);
    expect(getComputedStyle(screen.getByTestId('ticket-card')).borderTopColor).toBe(rgb(tone.claude.border));
  });

  it('opens with a click, and is a focusable button named after the ticket and its state', () => {
    const store = runningStore();
    act(() => store.openGate(ID, 'planning', 3_200));
    const onPress = vi.fn();
    render(<AgentTicketCard ticketId={ID} store={store} onPress={onPress} />);

    const button = screen.getByRole('button', { name: /#71273, Cutover frmJobControl to Blazor, Implementing/ });
    expect(button.getAttribute('aria-label')).toContain('Needs you · approve plan');
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('follows the store: an event on the ticket updates the card', () => {
    const store = runningStore();
    render(<AgentTicketCard ticketId={ID} store={store} testID="ticket" />);
    expect(screen.queryByTestId('ticket-card-footer')).toBeNull();

    act(() => store.openGate(ID, 'create-pr', 4_000));
    expect(screen.getByTestId('ticket-card-footer').textContent).toBe('Needs you · approve PR');

    act(() => store.resolveGate(ID));
    expect(screen.queryByTestId('ticket-card-footer')).toBeNull();
  });

  it('renders nothing for a ticket the board does not have', () => {
    const { container } = render(<AgentTicketCard ticketId="missing" store={runningStore()} />);
    expect(container.textContent).toBe('');
  });

  it('shows the folder name for a "No ticket" ticket', () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ id: 'nt-20261007-fix-the-login', ado: null, title: 'Fix the login' })]);
    render(<AgentTicketCard ticketId="nt-20261007-fix-the-login" store={store} />);
    expect(screen.getByText('nt-20261007-fix-the-login')).toBeTruthy();
    expect(screen.queryByText(/^#/)).toBeNull();
  });
});

describe('cardView', () => {
  it('puts a needs-you band ahead of a failed build and a pending switch', () => {
    const store = runningStore();
    store.setLastBuild(ID, { outcome: 'failed', startedAt: 1, finishedAt: 2, errors: 1, warnings: 0 });
    store.requestModelChange(ID, { model: 'haiku' }, 3);
    expect(cardView(store.getState().byId.get(ID)!).footer).toEqual({ tone: 'danger', label: 'Build failed · 1 error' });
    store.setNeedsYou(ID, { kind: 'qa-gap', gaps: 2, since: 4 });
    expect(cardView(store.getState().byId.get(ID)!).footer).toEqual({ tone: 'attention', label: 'Needs you · 2 gaps' });
  });

  it('does not show a failed build while a new build runs', () => {
    const store = runningStore();
    store.setLastBuild(ID, { outcome: 'failed', startedAt: 1, finishedAt: 2, errors: 1, warnings: 0 });
    store.applyBuildJob({ ticketId: ID, jobId: 'j1', kind: 'build', state: 'running', position: null });
    expect(cardView(store.getState().byId.get(ID)!).state).toBe('running');
  });

  it('words every gate', () => {
    expect(
      (['planning', 'implementing', 'code-review', 'qa', 'create-pr'] as const).map((stage) =>
        needsYouLabel({ kind: 'approval', stage, since: 0 }),
      ),
    ).toEqual([
      'Needs you · approve plan',
      'Needs you · approve changes',
      'Needs you · approve fixes',
      'Needs you · approve QA',
      'Needs you · approve PR',
    ]);
  });
});

describe('AgentTicketCard design indicator (AL-200)', () => {
  it('shows nothing before a spec is shipped, amber "not yet used" until the agent acknowledges it, then "Design vN"', () => {
    const store = runningStore();
    render(<AgentTicketCard ticketId={ID} store={store} testID="ticket" />);
    expect(screen.queryByTestId('ticket-design')).toBeNull();

    act(() => store.setDesignSpec(ID, 3, 'shipped', 4_000));
    expect(screen.getByTestId('ticket-design').textContent).toBe('Design v3 not yet used');
    expect(getComputedStyle(screen.getByTestId('ticket-design')).backgroundColor).toBe(rgb(tone.attention.band));
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Design v3 not yet used');

    act(() => store.setDesignSpec(ID, 3, 'used', 4_100));
    expect(screen.getByTestId('ticket-design').textContent).toBe('Design v3');
    expect(getComputedStyle(screen.getByTestId('ticket-design')).backgroundColor).toBe(rgb(tone.claude.band));
  });

  it('reads the indicator from the record at start-up', () => {
    const store = createAgentTicketStore();
    const spec = { version: 2, shippedAt: 1_500, approvedBy: 'Kyle', artboardCount: 2, usedAt: null, fetchedAt: null, deliveredAt: null };
    store.load([fakeTicketRecord({ id: ID, design: { canvas: null, lastViewUrl: null, specs: [spec] } })]);
    render(<AgentTicketCard ticketId={ID} store={store} testID="ticket" />);
    expect(screen.getByTestId('ticket-design').textContent).toBe('Design v2 not yet used');
  });
});
