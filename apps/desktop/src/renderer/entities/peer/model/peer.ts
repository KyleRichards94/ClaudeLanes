import type { PeerKind, PeerNetworkStatus, PeerRoom, PeerRooms, RoomMember } from '@agent-lanes/contracts';
import type { Tone } from '@agent-lanes/tokens';

/**
 * Peer lanes on the board (AL-293, PL§2): who else is on a Feature, the files two agents both
 * touched, and the counts behind the Assist bubble.
 */

/** Files both lists name, in the first list's order. */
export function overlap(localTouched: readonly string[], peerTouched: readonly string[]): string[] {
  const theirs = new Set(peerTouched);
  return localTouched.filter((path) => theirs.has(path));
}

/** The file's name without its folders: `src/Jobs/JobDto.cs` → `JobDto.cs`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The room a ticket on this board is in. */
export function roomOfTicket(rooms: PeerRooms | undefined, ticketId: string): PeerRoom | undefined {
  return rooms?.rooms.find((room) => room.members.some((member) => member.local && member.lane.ticketId === ticketId));
}

/** Everyone else in the ticket's room: other people's lanes, and this computer's other lanes. */
export function othersInRoom(room: PeerRoom, ticketId: string): RoomMember[] {
  return room.members.filter((member) => !(member.local && member.lane.ticketId === ticketId));
}

/** The attention row's content: who else is in which of this lane's files, or on its work item. */
export function overlapOf(room: PeerRoom, ticketId: string): Array<{ user: string; files: string[]; sameItem: boolean }> {
  const mine = room.members.find((member) => member.local && member.lane.ticketId === ticketId);
  if (!mine) return [];
  return othersInRoom(room, ticketId)
    .filter((member) => !member.local)
    .map((member) => ({
      user: member.user,
      files: overlap(mine.touched, member.touched),
      sameItem: mine.lane.workItemId !== null && member.lane.workItemId === mine.lane.workItemId,
    }))
    .filter((row) => row.files.length > 0 || row.sameItem);
}

/** `Kyle is also in JobService.cs, JobDto.cs` · `Kyle's agent is also on #48162`. */
export function overlapText(rows: ReadonlyArray<{ user: string; files: string[]; sameItem: boolean }>, workItemId: number | null): string | null {
  if (rows.length === 0) return null;
  return rows
    .map((row) => {
      const first = row.user.split(' ')[0] ?? row.user;
      return row.files.length > 0
        ? `${first} is also in ${row.files.map(fileName).join(', ')}`
        : `${first}'s agent is also on #${workItemId ?? ''}`;
    })
    .join(' · ');
}

/** Unread `ask`, `blocked` and `offer` across every room. */
export function totalUnread(rooms: PeerRooms | undefined): number {
  return rooms?.rooms.reduce((sum, room) => sum + room.unread, 0) ?? 0;
}

/** Unread messages in the rooms of these tickets, each room counted once. */
export function unreadForTickets(rooms: PeerRooms | undefined, ticketIds: readonly string[]): number {
  const ids = new Set(ticketIds);
  return (rooms?.rooms ?? []).filter((room) => room.members.some((member) => member.local && ids.has(member.lane.ticketId))).reduce((sum, room) => sum + room.unread, 0);
}

/** Another person's lane on a work item, from any room or none: the team board's live tag. */
export function peerOnWorkItem(rooms: PeerRooms | undefined, workItemId: number): RoomMember | undefined {
  if (!rooms) return undefined;
  const remote = [...rooms.rooms.flatMap((room) => room.members), ...rooms.others].filter((member) => !member.local);
  return remote.find((member) => member.lane.workItemId === workItemId);
}

/** `4 min ago`, `just now`. */
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** `14:02`. */
export function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 5);
}

/**
 * The board header's Peers pill (PL§2, PL§6): hidden while peer lanes is off (no team); red when the
 * listener failed; amber when an address under Advanced can't be reached, a peer's signature fails or
 * the beacon is down; grey with nobody found. A found peer that went away is normal, not amber.
 */
export function peersPillView(status: PeerNetworkStatus | undefined): { label: string; tone: Tone; hint: string } | null {
  if (!status || status.listener.state === 'off') return null;
  const online = status.peers.filter((peer) => peer.state === 'online');
  const label = `Peers · ${online.length} online`;
  if (status.listener.state === 'failed') return { label: 'Peers · not listening', tone: 'danger', hint: status.listener.message ?? 'The listener failed.' };
  const down = status.peers.filter((peer) => peer.state === 'rejected' || (peer.source === 'listed' && peer.state === 'unreachable'));
  if (down.length > 0) {
    return { label, tone: 'attention', hint: `Can't reach: ${down.map((peer) => `${peer.user ?? peer.address}${peer.state === 'rejected' ? ' (signature rejected)' : ''}`).join(' · ')}` };
  }
  if (status.beacon.state === 'failed') return { label, tone: 'attention', hint: status.beacon.message ?? 'The beacon failed, so other apps are not found.' };
  if (online.length > 0) return { label, tone: 'ok', hint: `Connected: ${online.map((peer) => peer.user ?? peer.address).join(' · ')}` };
  const team = status.peers.some((peer) => peer.state !== 'other-team');
  return { label: team ? label : 'Peers · none found', tone: 'neutral', hint: team ? 'No peer is connected right now.' : 'No other Agent Lanes in your Azure DevOps project has been found on this network.' };
}

export const KIND_LABELS: Record<PeerKind, string> = {
  hello: 'Joined',
  status: 'Status',
  touched: 'Touched',
  changed: 'Changed',
  blocked: 'Blocked',
  done: 'Done',
  ask: 'Ask',
  answer: 'Answer',
  offer: 'Offer',
  bye: 'Left',
};

export const KIND_TONES: Record<PeerKind, Tone> = {
  hello: 'neutral',
  status: 'neutral',
  touched: 'neutral',
  changed: 'ado',
  blocked: 'danger',
  done: 'ok',
  ask: 'attention',
  answer: 'claude',
  offer: 'ok',
  bye: 'neutral',
};

/** `Kyle Richards · KYLE-PC · #48161 · Implementing`. */
export function memberLine(member: RoomMember, stageLabel: (stage: string) => string): string {
  const item = member.lane.workItemId ? `#${member.lane.workItemId}` : member.lane.title;
  return [member.local ? `${member.user} (you)` : member.user, member.local ? null : member.host, item, stageLabel(member.lane.stage)].filter(Boolean).join(' · ');
}
