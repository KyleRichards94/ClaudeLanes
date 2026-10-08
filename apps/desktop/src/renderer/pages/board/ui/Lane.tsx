import { Fragment } from 'react';
import type { Lane as LaneName } from '@agent-lanes/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, glass, radius, space, tone } from '@agent-lanes/tokens';
import { Badge, GlassPanel, Text } from '@agent-lanes/ui';
import {
  AgentTicketCard,
  agentTickets,
  useLaneNeedsYouCount,
  useLaneTicketIds,
  type AgentTicketStore,
} from '@/entities/agent-ticket';
import { GateActions } from '@/features/resolve-gate';
import { LANE_LABELS } from '@/shared/config';
import { useUiPrefs } from '@/shared/model';
import { useRouter, routes } from '@/shared/routing';
import { EMPTY_LANE_COPY, collapsedLaneLabel, laneBadgeLabel } from '../model/lane-copy';

export interface LaneProps {
  lane: LaneName;
  store?: AgentTicketStore;
}

/**
 * One board lane (artboard 1): its name and count badge (amber when a card needs the user), its
 * cards oldest first, or the empty-lane copy (artboard 6). Pressing the header collapses the lane to
 * a vertical strip, as Done is by default; the choice is saved with the UI prefs (AL-041).
 */
export function Lane({ lane, store = agentTickets }: LaneProps) {
  const ids = useLaneTicketIds(lane, store);
  const needsYou = useLaneNeedsYouCount(lane, store);
  const collapsed = useUiPrefs((state) => state.collapsedLanes.includes(lane));
  const toggleLane = useUiPrefs((state) => state.toggleLane);
  const router = useRouter();
  const name = LANE_LABELS[lane];
  const badgeLabel = laneBadgeLabel(ids.length, needsYou);

  if (collapsed) {
    return (
      <Pressable
        role="button"
        aria-expanded={false}
        aria-label={`${collapsedLaneLabel(lane, name)}, ${badgeLabel}. Expand lane`}
        onPress={() => toggleLane(lane)}
        style={styles.strip}
        testID={`lane-${lane}`}
      >
        <Text variant="display" size="xl" color={lane === 'done' ? tone.ok.dot : needsYou > 0 ? tone.attention.text : color.ink}>
          {ids.length}
        </Text>
        <View style={styles.verticalSlot}>
          <View style={styles.verticalLine}>
            <Text variant="meta" size="sm" numberOfLines={1} style={styles.verticalText}>
              {collapsedLaneLabel(lane, name)}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const empty = EMPTY_LANE_COPY[lane];
  return (
    <GlassPanel level="md" style={styles.lane} testID={`lane-${lane}`}>
      <Pressable
        role="button"
        aria-expanded
        aria-label={`${name}, ${badgeLabel}. Collapse lane`}
        onPress={() => toggleLane(lane)}
        style={styles.header}
      >
        <Text variant="title" size="md" role="heading" aria-level={2} numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Badge count={ids.length} tone={needsYou > 0 ? 'attention' : 'default'} label={badgeLabel} style={styles.badge} />
      </Pressable>
      <View style={styles.cards}>
        {ids.length === 0 ? (
          <View style={styles.empty} testID={`lane-${lane}-empty`}>
            <Text variant="title" size="md" style={styles.centred}>
              {empty.title}
            </Text>
            <Text variant="meta" size="sm" style={styles.centred}>
              {empty.body}
            </Text>
          </View>
        ) : (
          ids.map((id) => (
            <Fragment key={id}>
              <AgentTicketCard ticketId={id} store={store} testID={`card-${id}`} onPress={() => router.navigate(routes.ticket(id))} />
              {/* Approve / Request changes while a gate waits; the drill-in stepper shows the same action (AL-171). */}
              <GateActions ticketId={id} placement="card" store={store} />
            </Fragment>
          ))
        )}
      </View>
    </GlassPanel>
  );
}

/** A lane is at least this wide; below 6 lanes + the Done strip at this width the row scrolls sideways. */
export const LANE_MIN_WIDTH = 196;
/** The collapsed strip, read off artboard 1's Done lane (70 × 352). */
export const COLLAPSED_LANE_WIDTH = 70;
const verticalLength = 220;
const verticalLine = 20;

/** Read off artboard 1: 12 px inside the lane, 14 px header, 12 px between cards. */
const styles = StyleSheet.create({
  lane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: LANE_MIN_WIDTH,
    alignSelf: 'flex-start',
    paddingBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
  },
  name: {
    flexShrink: 1,
  },
  badge: {
    alignSelf: 'center',
  },
  cards: {
    gap: space.md,
    paddingHorizontal: space.md,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 120,
    paddingHorizontal: space.md,
    paddingVertical: space.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    backgroundColor: glass.fillMin,
  },
  centred: {
    textAlign: 'center',
  },
  strip: {
    width: COLLAPSED_LANE_WIDTH,
    flexShrink: 0,
    alignSelf: 'flex-start',
    minHeight: 352,
    alignItems: 'center',
    gap: space.lg,
    paddingTop: space.lg,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    backgroundColor: glass.fillMin,
  },
  // The label turns a quarter left and reads bottom to top, as on artboard 1.
  verticalSlot: {
    width: verticalLine,
    height: verticalLength,
  },
  // Laid out as a horizontal line centred on the slot, then turned; the turn does not change layout.
  verticalLine: {
    position: 'absolute',
    width: verticalLength,
    height: verticalLine,
    left: (verticalLine - verticalLength) / 2,
    top: (verticalLength - verticalLine) / 2,
    justifyContent: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  verticalText: {
    textAlign: 'center',
  },
});
