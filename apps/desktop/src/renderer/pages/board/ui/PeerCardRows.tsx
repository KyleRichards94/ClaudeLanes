import { StyleSheet, View } from 'react-native';
import type { PeerRoom } from '@agent-lanes/contracts';
import { radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import { othersInRoom, overlapOf, overlapText } from '@/entities/peer';

/** `Room · Feature #48000 · with Kyle, Rocky`. */
export function roomRowText(room: PeerRoom, ticketId: string): string {
  const names = [...new Set(othersInRoom(room, ticketId).map((member) => member.user.split(' ')[0] ?? member.user))];
  return `Room · ${room.parentType || 'Feature'} #${room.parentId}${names.length > 0 ? ` · with ${names.join(', ')}` : ' · nobody else yet'}`;
}

/**
 * A card's peer lanes rows (AL-293, PL§2): its room and who is in it, then, when someone else is in
 * the same files or on the same work item, an attention row naming them. The board leaves them off a lane in no room.
 */
export function PeerCardRows({ room, ticketId, workItemId }: { room: PeerRoom; ticketId: string; workItemId: number | null }) {
  const attention = overlapText(overlapOf(room, ticketId), workItemId);
  return (
    <View style={styles.rows}>
      <Text variant="meta" size="sm" numberOfLines={1} testID={`card-${ticketId}-room`}>
        {roomRowText(room, ticketId)}
      </Text>
      {attention ? (
        <View style={styles.attention} testID={`card-${ticketId}-overlap`}>
          <Icon name="alert" size={12} color={tone.attention.text} />
          <Text variant="meta" size="sm" color={tone.attention.text} numberOfLines={2} style={styles.attentionText}>
            {attention}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space.xs,
  },
  attention: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.control,
    backgroundColor: tone.attention.band,
  },
  attentionText: {
    flexShrink: 1,
  },
});
