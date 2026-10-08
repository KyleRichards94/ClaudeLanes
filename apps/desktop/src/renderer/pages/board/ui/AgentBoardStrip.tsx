import { LANES, type Lane } from '@agent-lanes/contracts';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { color, minTarget, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Badge, Icon, Text } from '@agent-lanes/ui';
import {
  agentTickets,
  useAgentTicket,
  useLaneNeedsYouCount,
  useLaneNeedsYouTicketIds,
  useLaneTicketIds,
  type AgentTicketStore,
} from '@/entities/agent-ticket';
import { laneDropStyle, useLaneDropTarget } from '@/features/drag-to-lane';
import { LANE_LABELS } from '@/shared/config';
import { usePrefersReducedMotion } from '@/shared/lib';
import { useRouter, routes } from '@/shared/routing';
import { stripCell, stripChipLabel } from '../model/agent-strip';
import { laneBadgeLabel } from '../model/lane-copy';
import { stripTransition } from './strip-motion';

export interface AgentBoardStripProps {
  /** Shown while the page has scrolled past the lanes; hidden, it takes no focus, presses or drops. */
  visible: boolean;
  /** Scrolls back up to the full agent board. */
  onExpand(): void;
  /** Mirrors the lanes' "need you" filter (AL-142). */
  needsYouOnly?: boolean;
  store?: AgentTicketStore;
}

/**
 * The agent board folded into a strip under the pinned header, once the page has scrolled down past
 * the lanes: one cell per lane with its name and count (amber when a card needs the user) and its
 * cards' ids as chips ("+N" past three). A lane cell, or the expand button, scrolls back up to the
 * full board; a chip opens its ticket. While a team board card is dragged, each cell is a drop target
 * for its lane, lit or faded like the lane (AL-235), so a card can be dropped without scrolling up.
 */
export function AgentBoardStrip({ visible, onExpand, needsYouOnly = false, store = agentTickets }: AgentBoardStripProps) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <View
      style={[styles.slot, stripTransition(reducedMotion), visible ? styles.shown : styles.hidden]}
      aria-hidden={!visible}
      pointerEvents={visible ? 'box-none' : 'none'}
      testID="agent-board-strip"
    >
      {/* Solid rather than glass: it sits over the team board's text, which must not show through. */}
      <View style={styles.strip}>
        <View style={styles.cells} role="group" aria-label="Agent board, collapsed">
          {LANES.map((lane) => (
            <StripLaneCell key={lane} lane={lane} visible={visible} needsYouOnly={needsYouOnly} store={store} onExpand={onExpand} />
          ))}
        </View>
        <Pressable role="button" aria-label="Show the agent board" onPress={onExpand} style={styles.expand} testID="agent-board-strip-expand">
          <Icon name="chevron-up" size={18} color={color.ink} />
        </Pressable>
      </View>
    </View>
  );
}

interface StripLaneCellProps {
  lane: Lane;
  visible: boolean;
  needsYouOnly: boolean;
  store: AgentTicketStore;
  onExpand(): void;
}

function StripLaneCell({ lane, visible, needsYouOnly, store, onExpand }: StripLaneCellProps) {
  const allIds = useLaneTicketIds(lane, store);
  const needsYouIds = useLaneNeedsYouTicketIds(lane, store);
  const ids = needsYouOnly ? needsYouIds : allIds;
  const needsYou = useLaneNeedsYouCount(lane, store);
  const { attach, state } = useLaneDropTarget(lane, { placement: 'strip', disabled: !visible });
  const name = LANE_LABELS[lane];
  const badgeLabel = laneBadgeLabel(ids.length, needsYou);
  const cell = stripCell(ids);

  return (
    <View ref={attach} style={[styles.cell, laneDropStyle(state)]} testID={`strip-lane-${lane}`}>
      <Pressable
        role="button"
        aria-label={`${name}, ${badgeLabel}. Show the agent board`}
        onPress={onExpand}
        style={styles.cellHead}
        testID={`strip-lane-${lane}-head`}
      >
        <Text variant="title" size="sm" numberOfLines={1} style={styles.cellName}>
          {name}
        </Text>
        <Badge count={ids.length} tone={needsYou > 0 ? 'attention' : 'default'} label={badgeLabel} />
      </Pressable>
      {cell.chips.length > 0 ? (
        <View style={styles.chips}>
          {cell.chips.map((id) => (
            <StripChip key={id} ticketId={id} store={store} />
          ))}
          {cell.overflowLabel ? (
            <Text variant="meta" size="xs" aria-label={`${cell.overflow} more`} testID={`strip-lane-${lane}-more`}>
              {cell.overflowLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A card in the strip, by its id; pressing it opens the ticket. */
function StripChip({ ticketId, store }: { ticketId: string; store: AgentTicketStore }) {
  const ticket = useAgentTicket(ticketId, store);
  const router = useRouter();
  if (!ticket) return null;
  const label = stripChipLabel(ticket);
  return (
    <Pressable
      role="button"
      aria-label={`Open ${label}, ${ticket.title}`}
      onPress={() => router.navigate(routes.ticket(ticketId))}
      style={styles.chipTarget}
      testID={`strip-chip-${ticketId}`}
    >
      <View style={[styles.chip, ticket.ado ? styles.adoChip : styles.localChip]}>
        <Text variant="mono" size="xs" color={ticket.ado ? tone.ado.text : tone.neutral.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Floats under the header: it takes no room, so showing it moves nothing on the page.
  slot: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: space.sm,
  },
  shown: {
    opacity: 1,
    transform: [{ translateY: 0 }],
    visibility: 'visible',
  } as ViewStyle,
  hidden: {
    opacity: 0,
    transform: [{ translateY: -space.sm }],
    visibility: 'hidden',
  } as ViewStyle,
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.lifted,
  } as ViewStyle,
  cells: {
    flex: 1,
    flexDirection: 'row',
    gap: space.sm,
    minWidth: 0,
  },
  cell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingHorizontal: space.xs,
    borderRadius: radius.chip,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cellHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: minTarget,
    minWidth: minTarget,
  },
  cellName: {
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  chipTarget: {
    minHeight: minTarget,
    minWidth: minTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.chip,
  },
  adoChip: {
    backgroundColor: tone.ado.band,
  },
  localChip: {
    backgroundColor: tone.neutral.band,
  },
  expand: {
    width: minTarget,
    minHeight: minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
});
