import { LANES, type Lane, type TicketRecord } from '@agent-lanes/contracts';
import { act, render } from '@testing-library/react';
import { Profiler, memo, type ProfilerOnRenderCallback } from 'react';
import { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'zustand';
import {
  agentTickets,
  useAgentTicket,
  useAgentTicketCount,
  useLaneNeedsYouCount,
  useLaneTicketIds,
} from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { startEventHub, stopEventHub } from './EventHub';

/**
 * AL-141 acceptance: a burst of output on one ticket does not re-render other cards. The board below
 * is a stand-in for AL-143's lanes and AL-144's cards, built on the same entity hooks; events travel
 * the real path (fake bridge → the app's event hub → `agentTicketEventHandlers` → store). Every card
 * and lane sits in a React Profiler, which reports each commit that re-rendered something inside it.
 */

const STREAMING = '71273';
/** The artboard 1 board: 71273 and 71288 in Implementing, one card in every other stage lane, 71330 queued. */
const BOARD: readonly TicketRecord[] = [
  fakeTicketRecord({ id: '71330', stage: 'queued', stageEnteredAt: 100 }),
  fakeTicketRecord({ id: '71322', stage: 'planning', stageEnteredAt: 110 }),
  fakeTicketRecord({ id: STREAMING, stage: 'implementing', stageEnteredAt: 120 }),
  fakeTicketRecord({ id: '71288', stage: 'implementing', stageEnteredAt: 130 }),
  fakeTicketRecord({ id: '71301', stage: 'code-review', stageEnteredAt: 140 }),
  fakeTicketRecord({ id: '71310', stage: 'qa', stageEnteredAt: 150 }),
  fakeTicketRecord({ id: '71266', stage: 'create-pr', stageEnteredAt: 160 }),
];

let bridge: FakeBridge;
/** Profiler id → commits that re-rendered something inside it since `resetRenders()`. */
let renders: Map<string, number>;
const onRender: ProfilerOnRenderCallback = (id, phase) => {
  if (phase !== 'mount') renders.set(id, (renders.get(id) ?? 0) + 1);
};
const rendersOf = (id: string) => renders.get(id) ?? 0;
const resetRenders = () => {
  renders = new Map();
};

// memo stands in for the React Compiler, which the app build runs and Vitest does not.
const Card = memo(function Card({ ticketId }: { ticketId: string }) {
  const ticket = useAgentTicket(ticketId);
  return <View testID={`card-${ticketId}`} aria-label={`${ticket?.title} · ${ticket?.lastOutputAt ?? 'idle'}`} />;
});

const LaneColumn = memo(function LaneColumn({ lane }: { lane: Lane }) {
  const ids = useLaneTicketIds(lane);
  const needsYou = useLaneNeedsYouCount(lane);
  return (
    <View testID={`lane-${lane}`} aria-label={`${ids.length} · ${needsYou} need you`}>
      {ids.map((id) => (
        <Profiler key={id} id={`card:${id}`} onRender={onRender}>
          <Card ticketId={id} />
        </Profiler>
      ))}
    </View>
  );
});

const HeaderCounts = memo(function HeaderCounts() {
  const running = useAgentTicketCount('running');
  const needYou = useAgentTicketCount('needs-you');
  const queued = useAgentTicketCount('queued');
  return <View testID="header-counts" aria-label={`${running} running · ${needYou} need you · ${queued} queued`} />;
});

function Board() {
  return (
    <View>
      <Profiler id="header" onRender={onRender}>
        <HeaderCounts />
      </Profiler>
      {LANES.map((lane) => (
        <Profiler key={lane} id={`lane:${lane}`} onRender={onRender}>
          <LaneColumn lane={lane} />
        </Profiler>
      ))}
    </View>
  );
}

/** Sends `count` agent:output events for one ticket, spread evenly over `frames` animation frames. */
function streamOutput(ticketId: string, count: number, frames: number) {
  const perFrame = Math.ceil(count / frames);
  let at = 1_000;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let i = 0; i < perFrame && at < 1_000 + count; i += 1) {
      bridge.emit('agent:output', { ticketId, at });
      at += 1;
    }
    act(() => {
      vi.advanceTimersToNextFrame();
    });
  }
}

const otherCards = BOARD.map((record) => record.id).filter((id) => id !== STREAMING);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  bridge = installFakeBridge();
  // The app's real wiring: event-routes.ts registers the agent ticket handlers with the hub.
  startEventHub();
  agentTickets.load(BOARD);
  resetRenders();
});

afterEach(() => {
  stopEventHub();
  agentTickets.load([]);
  vi.useRealTimers();
});

describe('agent ticket rendering (React Profiler)', () => {
  it('re-renders only the streaming card, once per frame, during a burst of 1,000 output events', () => {
    const view = render(<Board />);
    resetRenders();

    streamOutput(STREAMING, 1_000, 10);

    // One store commit per frame, so the streaming card renders once per frame.
    expect(rendersOf(`card:${STREAMING}`)).toBe(10);
    for (const id of otherCards) expect(rendersOf(`card:${id}`), `card ${id}`).toBe(0);
    // Lanes the streaming card is not in, and the header counts, never render.
    for (const lane of LANES.filter((lane) => lane !== 'implementing')) expect(rendersOf(`lane:${lane}`), `lane ${lane}`).toBe(0);
    expect(rendersOf('header')).toBe(0);

    expect(view.getByTestId(`card-${STREAMING}`).getAttribute('aria-label')).toBe('Cutover frmJobControl to Blazor · 1999');
  });

  it('keeps the other cards still when two tickets stream in the same frames', () => {
    render(<Board />);
    resetRenders();

    for (let frame = 0; frame < 5; frame += 1) {
      for (let i = 0; i < 100; i += 1) {
        bridge.emit('agent:output', { ticketId: STREAMING, at: 2_000 + frame * 100 + i });
        bridge.emit('agent:output', { ticketId: '71301', at: 2_000 + frame * 100 + i });
      }
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    }

    expect(rendersOf(`card:${STREAMING}`)).toBe(5);
    expect(rendersOf('card:71301')).toBe(5);
    for (const id of otherCards.filter((id) => id !== '71301')) expect(rendersOf(`card:${id}`), `card ${id}`).toBe(0);
  });

  it('re-renders only the affected card, its lanes and the counts when a ticket changes lane or needs the user', () => {
    const view = render(<Board />);
    resetRenders();

    act(() => agentTickets.openGate('71301', 'code-review', 3_000));

    expect(rendersOf('card:71301')).toBe(1);
    expect(rendersOf('header')).toBe(1);
    for (const id of otherCards.filter((id) => id !== '71301')) expect(rendersOf(`card:${id}`), `card ${id}`).toBe(0);
    expect(view.getByTestId('header-counts').getAttribute('aria-label')).toBe('5 running · 1 need you · 1 queued');
    expect(view.getByTestId('lane-code-review').getAttribute('aria-label')).toBe('1 · 1 need you');

    resetRenders();
    act(() => agentTickets.setStage('71330', 'planning', 3_100));

    expect(rendersOf('lane:queued')).toBe(1);
    expect(rendersOf('lane:planning')).toBe(1);
    for (const lane of LANES.filter((lane) => lane !== 'queued' && lane !== 'planning')) {
      expect(rendersOf(`lane:${lane}`), `lane ${lane}`).toBe(0);
    }
    expect(view.getByTestId('lane-planning').getAttribute('aria-label')).toBe('2 · 0 need you');
  });

  it('would catch a card that subscribes to more than its own ticket (control)', () => {
    const WholeBoardCard = memo(function WholeBoardCard({ ticketId }: { ticketId: string }) {
      const byId = useStore(agentTickets, (state) => state.byId);
      return <View aria-label={byId.get(ticketId)?.title} />;
    });
    render(
      <Profiler id="naive:71288" onRender={onRender}>
        <WholeBoardCard ticketId="71288" />
      </Profiler>,
    );
    resetRenders();

    streamOutput(STREAMING, 100, 2);

    expect(rendersOf('naive:71288')).toBe(2);
  });
});
