import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerRooms } from '@agent-lanes/contracts';
import { closeRooms, useRoomsPanel } from '@/shared/model';
import { fakeAdoRow, installFakeBridge } from '@/shared/testing';
import { RoomsPanel } from '@/widgets/room-log';
import { AssistBubble, LaneAssistBubble } from './AssistBubble';

/** AL-294: the Assist bubble in the header and on a lane, from fake peers' messages. */

const ROOM = 'https://dev.azure.com/contoso#48000';
const BLOCKED = '00000000-0000-4000-8000-000000000001';

function rooms(unread: number): PeerRooms {
  return {
    rooms: [
      {
        id: ROOM,
        parentId: 48000,
        parentType: 'Feature',
        parentTitle: 'Job DTO',
        unread,
        members: [
          { instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', user: 'Mitch Healy', host: 'MITCH-PC', lane: { ticketId: '71273', workItemId: 71273, title: 'Cutover', stage: 'implementing', branch: '71273-x', parentId: 48000 }, touched: [], lastSeenAt: 0, local: true, reachable: true },
        ],
      },
    ],
    others: [],
  };
}

const blocked = {
  v: 1,
  id: BLOCKED,
  room: ROOM,
  kind: 'blocked',
  from: { user: 'Rocky Smith', host: 'ROCKY-PC', instance: '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false },
  lane: { ticketId: '71290', workItemId: 71290, title: 'Mapper', stage: 'implementing', branch: '71290-x', parentId: 48000 },
  text: 'Need the Status enum from #71280',
  data: {},
  sentAt: '2026-10-29T03:14:00.000Z',
  replay: false,
  own: false,
} as const;

function Probe() {
  return <span data-testid="panel-open">{String(useRoomsPanel((state) => state.open))}</span>;
}

function setup(unread: number) {
  const state = { unread };
  const bridge = installFakeBridge({ 'connections:list': { ok: true, data: [fakeAdoRow()] } });
  const others = bridge.invoke;
  bridge.invoke = vi.fn(async (channel: Parameters<typeof others>[0], payload?: unknown) => {
    if (channel === 'peers:rooms') return { ok: true, data: rooms(state.unread) };
    if (channel === 'peers:log') return { ok: true, data: { room: ROOM, messages: [blocked], capped: false } };
    if (channel === 'peers:markSeen') {
      state.unread = 0;
      return { ok: true, data: { total: 0, byRoom: {}, byTicket: {} } };
    }
    if (channel === 'peers:list') return { ok: true, data: { listener: { state: 'listening', port: 47811, message: null }, peers: [], teams: 1, refusedConnections: 0 } };
    return others(channel, payload);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AssistBubble />
      <LaneAssistBubble lane="implementing" ticketIds={['71273']} />
      <LaneAssistBubble lane="qa" ticketIds={['71330']} />
      <RoomsPanel />
      <Probe />
    </QueryClientProvider>,
  );
  return { bridge, state };
}

afterEach(() => act(() => closeRooms()));

describe('Assist bubble (AL-294)', () => {
  it('counts a blocked message on the header and on the lane whose ticket is in the room, as the lane badge does', async () => {
    setup(1);
    const header = await screen.findByTestId('assist-bubble');
    expect(header.getAttribute('aria-label')).toBe('1 waiting on you');
    expect(header.textContent).toBe('1');
    expect(screen.getByTestId('lane-implementing-assist').getAttribute('aria-label')).toBe('1 waiting on you in this lane');
    expect(screen.queryByTestId('lane-qa-assist')).toBeNull();
    expect(screen.getByTestId('assist-announce').textContent).toBe('1 waiting on you');
  });

  it('opens the Rooms panel on the room from the bubble and clears both bubbles', async () => {
    const { bridge } = setup(1);
    fireEvent.click(await screen.findByTestId('assist-bubble'));
    expect(screen.getByTestId('panel-open').textContent).toBe('true');
    expect((await screen.findByTestId('room-heading')).textContent).toBe('Feature #48000 · Job DTO');
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('peers:markSeen', { room: ROOM, upTo: BLOCKED }));
    await waitFor(() => expect(screen.queryByTestId('assist-bubble')).toBeNull());
    expect(screen.queryByTestId('lane-implementing-assist')).toBeNull();
    expect(screen.getByTestId(`room-message-${BLOCKED}`).textContent).toContain('new');
  });

  it('shows nothing while nothing is unread (a changed message is not counted by main)', async () => {
    const { bridge } = setup(0);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('peers:rooms', undefined));
    expect(screen.queryByTestId('assist-bubble')).toBeNull();
    expect(screen.queryByTestId('lane-implementing-assist')).toBeNull();
  });
});
