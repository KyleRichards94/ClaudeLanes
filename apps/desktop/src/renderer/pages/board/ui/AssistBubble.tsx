import { Pressable, StyleSheet, View } from 'react-native';
import type { PeerRooms } from '@agent-lanes/contracts';
import { minTarget } from '@agent-lanes/tokens';
import { Badge, Text } from '@agent-lanes/ui';
import { totalUnread, unreadForTickets } from '@/entities/peer';
import { usePeerRooms } from '@/shared/api';
import { openRooms } from '@/shared/model';
import { HoverHint } from './HoverHint';

export function waitingLabel(count: number): string {
  return `${count} waiting on you`;
}

/** The first room with something unread, for the tickets given (or any). */
function unreadRoom(rooms: PeerRooms | undefined, ticketIds?: readonly string[]): string | null {
  const ids = ticketIds ? new Set(ticketIds) : null;
  return rooms?.rooms.find((room) => room.unread > 0 && (!ids || room.members.some((member) => member.local && ids.has(member.lane.ticketId))))?.id ?? null;
}

/**
 * The Assist bubble (AL-294, P8): `ask`, `blocked` and `offer` messages in your rooms that you haven't
 * looked at, as a count pill in the lane-count style. Zero hides it; a click opens the Rooms panel on
 * the first unread message.
 */
export function AssistBubble() {
  const rooms = usePeerRooms().data;
  const count = totalUnread(rooms);
  return (
    <>
      {count > 0 ? (
        <HoverHint hint={waitingLabel(count)}>
          <Pressable role="button" aria-label={waitingLabel(count)} onPress={() => openRooms(unreadRoom(rooms))} style={styles.button} testID="assist-bubble">
            <Badge count={count} tone="attention" label={waitingLabel(count)} />
          </Pressable>
        </HoverHint>
      ) : null}
      <View style={styles.hidden}>
        <Text variant="meta" aria-live="polite" testID="assist-announce">
          {count > 0 ? waitingLabel(count) : ''}
        </Text>
      </View>
    </>
  );
}

/** A lane header's bubble: unread messages in the rooms of the lane's tickets. */
export function LaneAssistBubble({ lane, ticketIds }: { lane: string; ticketIds: readonly string[] }) {
  const rooms = usePeerRooms().data;
  const count = unreadForTickets(rooms, ticketIds);
  if (count === 0) return null;
  return (
    <Pressable role="button" aria-label={`${waitingLabel(count)} in this lane`} onPress={() => openRooms(unreadRoom(rooms, ticketIds))} style={styles.button} testID={`lane-${lane}-assist`}>
      <Badge count={count} tone="attention" label={`${waitingLabel(count)} in this lane`} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
  // Read out, not shown: the bubble itself says the count.
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
