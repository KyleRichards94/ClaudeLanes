import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PeerRoom } from '@agent-lanes/contracts';
import { space } from '@agent-lanes/tokens';
import { Button, Modal, SegmentedControl, Text } from '@agent-lanes/ui';
import { roomOfTicket } from '@/entities/peer';
import { useMarkSeen, usePeerNetwork, usePeerRooms, useRoomLog } from '@/shared/api';
import { closeRooms, openConnections, showRoom, useRoomsPanel } from '@/shared/model';
import { RoomComposer, RoomLog, RoomMembers } from './RoomLog';

export function roomHeading(room: PeerRoom): string {
  return `${room.parentType || 'Feature'} #${room.parentId}${room.parentTitle ? ` · ${room.parentTitle}` : ''}`;
}

/**
 * Showing a room counts as looking at it (P8): its unread messages are marked seen, and the ones that
 * were unread stay highlighted while it is on screen.
 */
function useSeenWhileShown(room: PeerRoom | undefined, shown: boolean): number {
  // A system row's id isn't one the unread count knows (AL-300): seen up to the last post.
  const last = useRoomLog(shown && room ? room.id : null)
    .data?.messages.filter((message) => !message.system)
    .at(-1)?.id;
  const { mutate } = useMarkSeen();
  const key = shown && room ? room.id : '';
  const [highlight, setHighlight] = useState({ key: '', count: 0 });
  if (highlight.key !== key) setHighlight({ key, count: room?.unread ?? 0 });
  useEffect(() => {
    if (shown && room && room.unread > 0 && last) mutate({ room: room.id, upTo: last });
  }, [shown, room, last, mutate]);
  return highlight.count;
}

function RoomBody({ room, focus, highlight, height }: { room: PeerRoom; focus: string | null; highlight: number; height: number }) {
  return (
    <View style={styles.body}>
      <Text variant="title" testID="room-heading">
        {roomHeading(room)}
      </Text>
      <RoomMembers room={room} />
      <RoomLog room={{ ...room, unread: highlight }} focus={focus} height={height} />
      <RoomComposer room={room} />
    </View>
  );
}

/** The board's Rooms panel (AL-295, PL§2): every room this app's lanes are in, its members and its log. */
export function RoomsPanel() {
  const open = useRoomsPanel((state) => state.open);
  const wanted = useRoomsPanel((state) => state.room);
  const focus = useRoomsPanel((state) => state.focus);
  const rooms = usePeerRooms().data?.rooms ?? [];
  const room = rooms.find((item) => item.id === wanted) ?? rooms[0];
  const highlight = useSeenWhileShown(room, open);

  return (
    <Modal
      visible={open}
      title="Rooms"
      subtitle={rooms.length === 0 ? 'None of your lanes is in a room yet' : 'Agents on the same Feature, on this computer and others'}
      icon="link"
      width={760}
      onClose={closeRooms}
      footer={<Button label="Close" onPress={closeRooms} />}
      testID="rooms-panel"
    >
      {room ? (
        <View style={styles.body}>
          {rooms.length > 1 ? (
            <SegmentedControl<string>
              label="Room"
              tone="ink"
              value={room.id}
              onChange={showRoom}
              options={rooms.map((item) => ({ value: item.id, label: `#${item.parentId}${item.unread > 0 ? ` · ${item.unread}` : ''}` }))}
              testID="rooms-picker"
            />
          ) : null}
          <RoomBody room={room} focus={focus} highlight={highlight} height={360} />
        </View>
      ) : (
        <Text variant="body">A lane joins a room when its work item sits under a Feature or Epic and peer lanes is set up.</Text>
      )}
    </Modal>
  );
}

/** The ticket page's Room tab (AL-295): the log of that ticket's room and a composer. */
export function RoomTab({ ticketId }: { ticketId: string }) {
  const network = usePeerNetwork();
  const room = roomOfTicket(usePeerRooms().data, ticketId);
  const highlight = useSeenWhileShown(room, true);
  if (network.data?.listener.state === 'off') {
    return (
      <View style={styles.body} testID="room-tab">
        <Text variant="body">Peer lanes is off. Set it up in Connections › Peers to talk to agents on the same Feature on other computers.</Text>
        <View style={styles.buttons}>
          <Button label="Open Connections" onPress={() => openConnections({ tab: 'peers' })} />
        </View>
      </View>
    );
  }
  if (!room) {
    return (
      <View style={styles.body} testID="room-tab">
        <Text variant="body">This ticket is in no room: its work item has no Feature or Epic above it, or Azure DevOps hasn&apos;t been read for it yet.</Text>
      </View>
    );
  }
  return (
    <View testID="room-tab">
      <RoomBody room={room} focus={null} highlight={highlight} height={420} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.md,
  },
  buttons: {
    flexDirection: 'row',
  },
});
