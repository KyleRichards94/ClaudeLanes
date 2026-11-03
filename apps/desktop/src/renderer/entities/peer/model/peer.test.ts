import { describe, expect, it } from 'vitest';
import type { PeerLinkState, PeerNetworkStatus, PeerRoom, PeerRooms, RoomMember } from '@agent-lanes/contracts';
import { overlap, overlapOf, overlapText, peerOnWorkItem, peersPillView, roomOfTicket, totalUnread, unreadForTickets } from './peer';
import { peerNetworkFixture } from '@agent-lanes/contracts/testing';

const ROOM = 'https://devops:8090/tfs/defaultcollection#48000';

function member(overrides: Partial<RoomMember> & { workItemId: number }): RoomMember {
  const { workItemId, ...rest } = overrides;
  return {
    instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    user: 'Mitch Healy',
    host: 'MITCH-PC',
    lane: { ticketId: String(workItemId), workItemId, title: 'Story', stage: 'implementing', branch: `${workItemId}-story`, parentId: 48000 },
    touched: [],
    lastSeenAt: 0,
    local: true,
    reachable: true,
    ...rest,
  };
}

const room: PeerRoom = {
  id: ROOM,
  parentId: 48000,
  parentType: 'Feature',
  parentTitle: 'Job DTO',
  unread: 2,
  members: [
    member({ workItemId: 48162, touched: ['src/JobDto.cs', 'src/JobService.cs', 'src/Mapper.cs'] }),
    member({ workItemId: 48161, local: false, user: 'Kyle Richards', host: 'KYLE-PC', touched: ['src/JobService.cs', 'src/JobDto.cs'] }),
    member({ workItemId: 48170, local: false, user: 'Rocky Smith', host: 'ROCKY-PC', touched: ['docs/README.md'] }),
  ],
};
const rooms: PeerRooms = { rooms: [room], others: [member({ workItemId: 50001, local: false, user: 'Rocky Smith', host: 'ROCKY-PC' })] };

describe('peer entity (AL-293)', () => {
  it('finds the files two lanes both touched', () => {
    expect(overlap(['a.cs', 'b.cs', 'c.cs'], ['c.cs', 'a.cs'])).toEqual(['a.cs', 'c.cs']);
    expect(overlapOf(room, '48162')).toEqual([{ user: 'Kyle Richards', files: ['src/JobDto.cs', 'src/JobService.cs'], sameItem: false }]);
    expect(overlapText(overlapOf(room, '48162'), 48162)).toBe('Kyle is also in JobDto.cs, JobService.cs');
    expect(overlapText([], 48162)).toBeNull();
  });

  it('says so when someone else is on the same work item', () => {
    const same: PeerRoom = { ...room, members: [member({ workItemId: 48162 }), member({ workItemId: 48162, local: false, user: 'Kyle Richards', host: 'KYLE-PC' })] };
    expect(overlapText(overlapOf(same, '48162'), 48162)).toBe("Kyle's agent is also on #48162");
  });

  it('finds the room of a ticket and the unread counts', () => {
    expect(roomOfTicket(rooms, '48162')?.id).toBe(ROOM);
    expect(roomOfTicket(rooms, '99999')).toBeUndefined();
    expect(totalUnread(rooms)).toBe(2);
    expect(unreadForTickets(rooms, ['48162', '48163'])).toBe(2);
    expect(unreadForTickets(rooms, ['48163'])).toBe(0);
  });

  it("finds another person's lane on a work item for the team board, in a room or not", () => {
    expect(peerOnWorkItem(rooms, 48161)?.user).toBe('Kyle Richards');
    expect(peerOnWorkItem(rooms, 50001)?.user).toBe('Rocky Smith');
    expect(peerOnWorkItem(rooms, 48162)).toBeUndefined();
  });

  it('shows the Peers pill by its words: hidden when off, red when not listening, amber when a listed peer is down, grey with nobody found', () => {
    const base: PeerNetworkStatus = peerNetworkFixture({ listener: { state: 'listening', port: 47811, message: null } });
    const link = (state: PeerLinkState, user: string | null, address: string, source: 'found' | 'listed' = 'listed') => ({ address, source, state, user, host: null, instance: null, lastSeenAt: null, rejectedFrames: 0, message: null });
    expect(peersPillView(undefined)).toBeNull();
    expect(peersPillView({ ...base, listener: { state: 'off', port: null, message: null } })).toBeNull();
    expect(peersPillView({ ...base, listener: { state: 'failed', port: 47811, message: 'Port 47811 is in use.' } })).toMatchObject({ label: 'Peers · not listening', tone: 'danger', hint: 'Port 47811 is in use.' });
    expect(peersPillView(base)).toMatchObject({ label: 'Peers · none found', tone: 'neutral' });
    expect(peersPillView({ ...base, peers: [link('other-team', 'Sam', '10.0.0.40:47811', 'found')] })).toMatchObject({ label: 'Peers · none found', tone: 'neutral' });
    expect(peersPillView({ ...base, peers: [link('unreachable', 'Kyle', '10.0.0.12:47811', 'found')] })).toMatchObject({ label: 'Peers · 0 online', tone: 'neutral' });
    expect(peersPillView({ ...base, beacon: { state: 'failed', port: 47810, message: 'UDP port 47810 is in use.' } })).toMatchObject({ tone: 'attention', hint: 'UDP port 47810 is in use.' });
    expect(peersPillView({ ...base, peers: [link('online', 'Kyle', 'KYLE-PC'), link('online', 'Rocky', 'ROCKY-PC'), link('online', 'Sam', 'SAM-PC')] })).toMatchObject({ label: 'Peers · 3 online', tone: 'ok' });
    expect(peersPillView({ ...base, peers: [link('online', 'Kyle', 'KYLE-PC'), link('unreachable', null, 'ROCKY-PC'), link('rejected', null, 'SAM-PC')] })).toEqual({
      label: 'Peers · 1 online',
      tone: 'attention',
      hint: "Can't reach: ROCKY-PC · SAM-PC (signature rejected)",
    });
  });
});
