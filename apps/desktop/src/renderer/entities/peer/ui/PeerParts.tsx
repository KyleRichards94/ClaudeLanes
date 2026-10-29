import { StyleSheet, View } from 'react-native';
import type { Lane, PeerKind, RoomMember } from '@agent-lanes/contracts';
import { space } from '@agent-lanes/tokens';
import { Pill, Text } from '@agent-lanes/ui';
import { LANE_LABELS } from '@/shared/config';
import { KIND_LABELS, KIND_TONES, ago, memberLine } from '../model/peer';

/** A peer's lane id in words; a lane this app doesn't know (a newer peer) as it came. */
export function peerStageLabel(stage: string): string {
  return (LANE_LABELS as Partial<Record<Lane, string>>)[stage as Lane] ?? stage;
}

/** A message's kind as a word on a pill, never colour alone (PL§6). */
export function KindPill({ kind, testID }: { kind: PeerKind; testID?: string }) {
  return <Pill label={KIND_LABELS[kind]} tone={KIND_TONES[kind]} {...(testID ? { testID } : {})} />;
}

/** One lane in a room: who, where, which item, which stage, and when it was last heard from. */
export function MemberRow({ member, now, testID }: { member: RoomMember; now: number; testID?: string }) {
  const seen = member.local ? null : member.reachable ? `seen ${ago(member.lastSeenAt, now)}` : `last seen ${new Date(member.lastSeenAt).toTimeString().slice(0, 5)}`;
  return (
    <View style={styles.row} testID={testID}>
      <Text variant="meta" size="md" style={styles.grow} numberOfLines={1}>
        {memberLine(member, peerStageLabel)}
      </Text>
      {seen ? <Text variant="meta">{seen}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  grow: {
    flex: 1,
    flexShrink: 1,
  },
});
