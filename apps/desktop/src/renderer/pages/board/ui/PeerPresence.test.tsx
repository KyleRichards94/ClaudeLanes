import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { PeerNetworkStatus, PeerRooms, RoomMember } from '@agent-lanes/contracts';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { MemberRow } from '@/entities/peer';
import { fakeAdoRow, fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { TeamBoardView } from '@/widgets/team-board';
import { BoardTicketCard } from './BoardTicketCard';
import { PeersPill } from './PeersPill';
import { peerNetworkFixture } from '@agent-lanes/contracts/testing';

/** AL-293: peer lanes presence on the board, the team board and the header, from fake peers' presence. */

const ROOM = 'https://dev.azure.com/contoso#48000';
const MINUTE = 60_000;

function member(overrides: Partial<RoomMember> & { workItemId: number }): RoomMember {
  const { workItemId, ...rest } = overrides;
  return {
    instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    user: 'Mitch Healy',
    host: 'MITCH-PC',
    lane: { ticketId: String(workItemId), workItemId, title: 'Story', stage: 'implementing', branch: `${workItemId}-story`, parentId: 48000 },
    touched: [],
    lastSeenAt: Date.now() - 4 * MINUTE,
    local: true,
    reachable: true,
    ...rest,
  };
}

/** Kyle on KYLE-PC and Rocky on ROCKY-PC, two fake peers; Kyle is in two of this lane's files. */
const rooms: PeerRooms = {
  rooms: [
    {
      id: ROOM,
      parentId: 48000,
      parentType: 'Feature',
      parentTitle: 'Job DTO',
      unread: 0,
      members: [
        member({ workItemId: 71273, touched: ['src/Jobs/JobDto.cs', 'src/Jobs/JobService.cs', 'src/Mapper.cs'] }),
        member({ workItemId: 71280, local: false, user: 'Kyle Richards', host: 'KYLE-PC', instance: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', touched: ['src/Jobs/JobService.cs', 'src/Jobs/JobDto.cs'] }),
        member({ workItemId: 71290, local: false, user: 'Rocky Smith', host: 'ROCKY-PC', instance: '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', touched: ['docs/README.md'] }),
      ],
    },
  ],
  others: [member({ workItemId: 71341, local: false, user: 'Kyle Richards', host: 'KYLE-PC' })],
};

function wrap(children: ReactNode, replies: Parameters<typeof installFakeBridge>[0]) {
  installFakeBridge({ 'connections:list': { ok: true, data: [fakeAdoRow({ id: 'ado:contoso', name: 'contoso', orgUrl: 'https://dev.azure.com/contoso' })] }, ...replies });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>);
}

function card(ticketId: string) {
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: ticketId, stage: 'implementing' })]);
  return <BoardTicketCard ticketId={ticketId} store={store} testID={`card-${ticketId}`} />;
}

describe('board presence (AL-293)', () => {
  it('shows the room and, for two lanes in the same files on two peers, the overlap row naming the user and the files', async () => {
    wrap(card('71273'), { 'peers:rooms': { ok: true, data: rooms } });
    expect((await screen.findByTestId('card-71273-room')).textContent).toBe('Room · Feature #48000 · with Kyle, Rocky');
    expect(screen.getByTestId('card-71273-overlap').textContent).toBe('Kyle is also in JobDto.cs, JobService.cs');
  });

  it('leaves both rows off a lane in no room', async () => {
    wrap(card('71330'), { 'peers:rooms': { ok: true, data: rooms } });
    await screen.findByTestId('card-71330');
    await waitFor(() => expect(screen.queryByTestId('card-71330-room')).toBeNull());
    expect(screen.queryByTestId('card-71330-overlap')).toBeNull();
  });

  it("tags a team-board card another person's agent is on, in words", () => {
    const card = { kind: 'item', id: 71341, idLabel: '#71341', type: 'Bug', typeColor: null, title: 'Roster view ignores public holidays', state: 'Active', stateColor: null, detail: null, avatar: null, lock: 'Assigned to Kyle Richards', agentTag: null, draggable: false, drag: null, webUrl: '' } as const;
    const column = { kind: 'board', id: 'todo', name: 'To Do', tone: 'todo', count: 1, cards: [card] } as never;
    render(
      <TeamBoardView
        peerTagFor={(id) => (id === 71341 ? "Kyle's agent · Implementing · 4 min ago" : null)}
        orgName="contoso"
        teams={[]}
        team={null}
        fromProfile={false}
        onTeamChange={() => undefined}
        filter="everyone"
        onFilterChange={() => undefined}
        columns={[column]}
        backlogTotal={null}
        state={{ kind: 'ready' }}
        prsError={null}
        onRetry={() => undefined}
        onConnect={() => undefined}
      />,
    );
    expect(screen.getByTestId('team-card-71341-peer').textContent).toBe("Kyle's agent · Implementing · 4 min ago");
    expect(screen.getByTestId('team-card-71341-lock')).toBeTruthy();
  });

  it('turns the Peers pill amber with the name when a peer is unreachable, and its members show when they were last seen', async () => {
    const network: PeerNetworkStatus = peerNetworkFixture({
      listener: { state: 'listening', port: 47811, message: null },
      peers: [
        { address: 'KYLE-PC', source: 'listed', state: 'online', user: 'Kyle Richards', host: 'KYLE-PC', instance: null, lastSeenAt: 1, rejectedFrames: 0, message: null },
        { address: 'ROCKY-PC', source: 'listed', state: 'unreachable', user: 'Rocky Smith', host: 'ROCKY-PC', instance: null, lastSeenAt: 1, rejectedFrames: 0, message: 'Nothing heard for 90 s.' },
      ],
    });
    wrap(<PeersPill />, { 'peers:list': { ok: true, data: network } });
    expect((await screen.findByTestId('peers-pill')).textContent).toBe('Peers · 1 online');

    const at = new Date(2026, 9, 29, 10, 42).getTime();
    render(<MemberRow member={member({ workItemId: 71290, local: false, user: 'Rocky Smith', host: 'ROCKY-PC', reachable: false, lastSeenAt: at })} now={at + 30_000} testID="rocky" />);
    expect(screen.getByTestId('rocky').textContent).toBe('Rocky Smith · ROCKY-PC · #71290 · Implementinglast seen 10:42');
  });

  it('hides the Peers pill while there is no Peers connection', async () => {
    wrap(<PeersPill />, { 'peers:list': { ok: true, data: peerNetworkFixture({ listener: { state: 'off', port: null, message: null } }) } });
    await waitFor(() => expect(screen.queryByTestId('peers-pill')).toBeNull());
  });
});
