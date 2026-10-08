import { StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, IdChip, Text } from '@agent-lanes/ui';
import { LaneDragCard } from '@/features/drag-to-lane';
import type { TeamBoardAvatar, TeamBoardItemView, TeamBoardPullRequestView } from '../model/view';

/** A 24 px initials circle: violet for the signed-in user ("KR"), grey for others, dashed "+" when unassigned (artboard 08). */
export function Avatar({ avatar }: { avatar: TeamBoardAvatar | null }) {
  if (!avatar) {
    return (
      <View style={[styles.avatar, styles.avatarEmpty]} aria-label="Unassigned" role="img">
        <Text variant="title" size="xs" color={color.muted}>
          +
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.avatar, avatar.mine ? styles.avatarMine : styles.avatarOther]} aria-label={avatar.mine ? `${avatar.name} (you)` : avatar.name} role="img">
      <Text variant="title" size="xs" color={avatar.mine ? color.surface : tone.neutral.text}>
        {avatar.initials}
      </Text>
    </View>
  );
}

function Grip({ enabled }: { enabled: boolean }) {
  return (
    <View aria-hidden style={styles.grip}>
      <Icon name="grip" size={14} color={enabled ? color.muted : color.line} />
    </View>
  );
}

/**
 * A work item on the team board (artboard 08): grip, `#id` chip, type, title, points (or PR, or
 * state) and the assignee's avatar. Someone else's item has a lock row with their name; an item an
 * agent works on has an "Agent in Implementing" tag. Both say so in words and an icon, never by
 * colour alone. One that can be dragged goes to an agent lane by pointer, Space or its Enter menu (AL-235).
 */
export function TeamBoardItemCard({ card }: { card: TeamBoardItemView }) {
  const summary = [
    `${card.idLabel} ${card.type}`,
    card.title,
    card.detail,
    card.avatar ? `assigned to ${card.avatar.mine ? 'you' : card.avatar.name}` : 'unassigned',
    card.lock ? `locked: ${card.lock}` : null,
    card.agentTag,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <LaneDragCard drag={card.drag} label={summary} style={[styles.card, card.agentTag ? styles.cardAgent : null]} testID={`team-card-${card.id}`}>
      <View style={styles.cardTop}>
        <Grip enabled={card.draggable} />
        <IdChip id={card.id} />
        <Text variant="meta" numberOfLines={1}>
          {card.type}
        </Text>
      </View>
      <Text variant="title" numberOfLines={2}>
        {card.title}
      </Text>
      <View style={styles.cardFooter}>
        <Text variant="meta" numberOfLines={1} style={styles.flexText}>
          {card.detail ?? ''}
        </Text>
        <Avatar avatar={card.avatar} />
      </View>
      {card.lock ? (
        <View style={[styles.band, styles.lockBand]} testID={`team-card-${card.id}-lock`}>
          <Icon name="lock" size={12} color={tone.neutral.text} />
          <Text variant="meta" size="sm" color={tone.neutral.text} numberOfLines={1}>
            {card.lock}
          </Text>
        </View>
      ) : null}
      {card.agentTag ? (
        <View style={[styles.band, styles.agentBand]} testID={`team-card-${card.id}-agent`}>
          <View aria-hidden style={styles.agentDot} />
          <Text variant="title" size="sm" color={tone.claude.text} numberOfLines={1}>
            {card.agentTag}
          </Text>
        </View>
      ) : null}
    </LaneDragCard>
  );
}

/** An open pull request in Active PRs: `!10598`, PR, title, "4 comments" in amber, reviewer avatar (artboard 08). */
export function TeamBoardPullRequestCard({ card }: { card: TeamBoardPullRequestView }) {
  const summary = [`Pull request ${card.idLabel}`, card.draft ? 'draft' : null, card.title, card.comments, card.note].filter(Boolean).join(', ');
  return (
    <LaneDragCard drag={card.drag} label={summary} style={styles.card} testID={`team-pr-${card.id}`}>
      <View style={styles.cardTop}>
        <Grip enabled={card.draggable} />
        <View style={styles.prChip}>
          <Text variant="mono" size="xs" color={tone.neutral.text}>
            {card.idLabel}
          </Text>
        </View>
        <Text variant="meta" numberOfLines={1}>
          {card.draft ? 'PR · Draft' : 'PR'}
        </Text>
      </View>
      <Text variant="title" numberOfLines={2}>
        {card.title}
      </Text>
      <View style={styles.cardFooter}>
        <Text variant="title" size="sm" color={card.hasComments ? tone.attention.text : color.muted} numberOfLines={1} style={styles.flexText}>
          {card.comments}
        </Text>
        <Avatar avatar={card.avatar} />
      </View>
      {card.note ? (
        <View style={[styles.band, styles.lockBand]}>
          <Icon name="alert" size={12} color={tone.neutral.text} />
          <Text variant="meta" size="sm" color={tone.neutral.text} numberOfLines={1}>
            {card.note}
          </Text>
        </View>
      ) : null}
    </LaneDragCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  cardAgent: {
    borderColor: tone.claude.border,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  grip: {
    marginLeft: -space.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  flexText: {
    flex: 1,
  },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
  },
  lockBand: {
    backgroundColor: tone.neutral.band,
  },
  agentBand: {
    backgroundColor: tone.claude.band,
  },
  agentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tone.claude.dot,
  },
  prChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.chip,
    backgroundColor: tone.neutral.band,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarMine: {
    backgroundColor: color.claude,
  },
  avatarOther: {
    backgroundColor: tone.neutral.band,
  },
  avatarEmpty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
  },
});
