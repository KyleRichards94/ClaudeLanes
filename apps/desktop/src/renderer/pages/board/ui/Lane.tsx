import { isSoloLane, type Lane as LaneName } from "@agent-lanes/contracts";
import { Pressable, StyleSheet, View } from "react-native";
import { useState, type ReactNode } from "react";
import {
  color,
  focusRing,
  glass,
  minTarget,
  radius,
  space,
  tone,
} from "@agent-lanes/tokens";
import { Badge, GlassPanel, Icon, Text } from "@agent-lanes/ui";
import {
  agentTickets,
  useLaneNeedsYouCount,
  useLaneNeedsYouTicketIds,
  useLaneTicketIds,
  type AgentTicketStore,
} from "@/entities/agent-ticket";
import {
  LaneDropHint,
  laneDropStyle,
  useLaneDropTarget,
} from "@/features/drag-to-lane";
import { BulkRemoveModal } from "@/features/remove-ticket";
import { GateActions } from "@/features/resolve-gate";
import { PermissionPrompt } from "@/features/resolve-permission";
import { LANE_LABELS } from "@/shared/config";
import { useIsLaunchedTicket, useUiPrefs } from "@/shared/model";
import { useRouter, routes } from "@/shared/routing";
import { LaneAssistBubble } from "./AssistBubble";
import { BoardTicketCard } from "./BoardTicketCard";
import { LaneSettingsModal } from "./LaneSettingsModal";
import { laneDropKinds } from "../model/lane-drops";
import {
  EMPTY_LANE_COPY,
  collapsedLaneLabel,
  laneBadgeLabel,
  needsYouEmptyCopy,
} from "../model/lane-copy";

export interface LaneProps {
  lane: LaneName;
  store?: AgentTicketStore;
  /** Show only the cards that need the user (the header's "need you" filter, AL-142). */
  needsYouOnly?: boolean;
}

/**
 * One board lane (artboard 1): its name and count badge (amber when a card needs the user), its
 * cards oldest first, or the empty-lane copy (artboard 6). Pressing the header collapses the lane to
 * a vertical strip, as Done is by default; the choice is saved with the UI prefs (AL-041).
 * While a team board card is dragged, a lane that takes it lights up with what the drop does and the
 * others fade (AL-235, artboard 09).
 */
export function Lane({
  lane,
  store = agentTickets,
  needsYouOnly = false,
}: LaneProps) {
  const allIds = useLaneTicketIds(lane, store);
  const needsYouIds = useLaneNeedsYouTicketIds(lane, store);
  const ids = needsYouOnly ? needsYouIds : allIds;
  const needsYou = useLaneNeedsYouCount(lane, store);
  const collapsed = useUiPrefs((state) => state.collapsedLanes.includes(lane));
  const toggleLane = useUiPrefs((state) => state.toggleLane);
  const router = useRouter();
  const name = LANE_LABELS[lane];
  const badgeLabel = laneBadgeLabel(ids.length, needsYou);
  const { attach, state: dropState } = useLaneDropTarget(lane);
  const dropStyle = laneDropStyle(dropState);
  // The header's settings button (skills and initial prompt for this lane's drops) shows on hover or focus.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Done and the single-step lanes can be cleared in one go.
  const [removeAllOpen, setRemoveAllOpen] = useState(false);
  const bulkRemovable =
    (lane === "done" || isSoloLane(lane)) && allIds.length > 0;
  const removeAll = (
    <BulkRemoveModal
      laneName={name}
      ticketIds={allIds}
      visible={removeAllOpen}
      onClose={() => setRemoveAllOpen(false)}
      store={store}
      testID={`lane-${lane}-remove-all`}
    />
  );

  if (collapsed) {
    return (
      <View style={styles.stripColumn}>
        <Pressable
          ref={attach}
          role="button"
          aria-expanded={false}
          aria-label={`${collapsedLaneLabel(lane, name)}, ${badgeLabel}. Expand lane`}
          onPress={() => toggleLane(lane)}
          style={[styles.strip, dropStyle]}
          testID={`lane-${lane}`}
        >
          <Text
            variant="display"
            size="xl"
            color={
              lane === "done"
                ? tone.ok.dot
                : needsYou > 0
                  ? tone.attention.text
                  : color.ink
            }
          >
            {ids.length}
          </Text>
          <View style={styles.verticalSlot}>
            <View style={styles.verticalLine}>
              <Text
                variant="meta"
                size="sm"
                numberOfLines={1}
                style={styles.verticalText}
              >
                {collapsedLaneLabel(lane, name)}
              </Text>
            </View>
          </View>
        </Pressable>
        {bulkRemovable ? (
          <Pressable
            role="button"
            aria-label={`Remove all ${allIds.length} from ${name}`}
            onPress={() => setRemoveAllOpen(true)}
            style={styles.stripRemoveAll}
            testID={`lane-${lane}-remove-all`}
          >
            <Icon name="archive" size={16} color={color.muted} />
          </Pressable>
        ) : null}
        {removeAll}
      </View>
    );
  }

  const empty = needsYouOnly ? needsYouEmptyCopy(name) : EMPTY_LANE_COPY[lane];
  return (
    <GlassPanel
      level="md"
      ref={attach}
      style={[styles.lane, dropStyle]}
      testID={`lane-${lane}`}
    >
      <View
        style={styles.headerRow}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <Pressable
          role="button"
          aria-expanded
          aria-label={`${name}, ${badgeLabel}. Collapse lane`}
          onPress={() => toggleLane(lane)}
          style={styles.header}
        >
          <Text
            variant="title"
            size="md"
            role="heading"
            aria-level={2}
            numberOfLines={1}
            style={styles.name}
          >
            {name}
          </Text>
          <Badge
            count={ids.length}
            tone={needsYou > 0 ? "attention" : "default"}
            label={badgeLabel}
            style={styles.badge}
          />
        </Pressable>
        {/* Unread ask, blocked and offer in the rooms of this lane's tickets (AL-294). */}
        <LaneAssistBubble lane={lane} ticketIds={ids} />
        {bulkRemovable ? (
          <Pressable
            role="button"
            aria-label={`Remove all ${allIds.length} from ${name}`}
            onPress={() => setRemoveAllOpen(true)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[
              styles.settingsButton,
              !(hovered || focused) && styles.settingsHidden,
            ]}
            testID={`lane-${lane}-remove-all`}
          >
            <Icon name="archive" size={14} color={color.muted} />
          </Pressable>
        ) : null}
        {laneDropKinds(lane).length > 0 ? (
          // Shown while the pointer is over the header, or while it has keyboard focus.
          <Pressable
            role="button"
            aria-label={`${name} settings`}
            onPress={() => setSettingsOpen(true)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[
              styles.settingsButton,
              !(hovered || focused) && styles.settingsHidden,
            ]}
            testID={`lane-${lane}-settings`}
          >
            <Icon name="edit" size={14} color={color.muted} />
          </Pressable>
        ) : null}
      </View>
      <LaneSettingsModal
        lane={lane}
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      {removeAll}
      <View style={styles.cards}>
        <LaneDropHint lane={lane} state={dropState} />
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
            <LaunchedCardSlot key={id} ticketId={id}>
              <BoardTicketCard
                ticketId={id}
                store={store}
                testID={`card-${id}`}
                onPress={() => router.navigate(routes.ticket(id))}
              />
              {/* Allow once / Allow for this ticket / Deny under the card while a tool call waits (AL-109). */}
              <PermissionPrompt ticketId={id} />
              {/* Approve / Request changes while a gate waits; the drill-in stepper shows the same action (AL-171). */}
              <GateActions ticketId={id} placement="card" store={store} />
            </LaunchedCardSlot>
          ))
        )}
      </View>
    </GlassPanel>
  );
}

/** A card and what sits under it; the card just launched gets a ring for a few seconds (AL-165). */
function LaunchedCardSlot({
  ticketId,
  children,
}: {
  ticketId: string;
  children: ReactNode;
}) {
  const launched = useIsLaunchedTicket(ticketId);
  return (
    <View
      style={[styles.cardSlot, launched && styles.launched]}
      testID={launched ? `card-${ticketId}-launched` : undefined}
    >
      {children}
    </View>
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
  cardSlot: {
    gap: space.sm,
    borderRadius: radius.card,
  },
  launched: {
    outlineColor: focusRing.color,
    outlineWidth: focusRing.width,
    outlineOffset: focusRing.offset,
    outlineStyle: "solid",
  },
  lane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: LANE_MIN_WIDTH,
    alignSelf: "flex-start",
    paddingBottom: space.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: space.xs,
  },
  header: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
  },
  settingsButton: {
    width: minTarget,
    height: minTarget,
    marginTop: space.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control,
  },
  settingsHidden: {
    opacity: 0,
  },
  stripColumn: {
    alignSelf: "flex-start",
    alignItems: "center",
    gap: space.sm,
  },
  stripRemoveAll: {
    width: minTarget,
    height: minTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: glass.fillMin,
  },
  name: {
    flexShrink: 1,
  },
  badge: {
    alignSelf: "center",
  },
  cards: {
    gap: space.md,
    paddingHorizontal: space.md,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    minHeight: 120,
    paddingHorizontal: space.md,
    paddingVertical: space.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line,
    backgroundColor: glass.fillMin,
  },
  centred: {
    textAlign: "center",
  },
  strip: {
    width: COLLAPSED_LANE_WIDTH,
    flexShrink: 0,
    alignSelf: "flex-start",
    minHeight: 352,
    alignItems: "center",
    gap: space.lg,
    paddingTop: space.lg,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderStyle: "dashed",
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
    position: "absolute",
    width: verticalLength,
    height: verticalLine,
    left: (verticalLine - verticalLength) / 2,
    top: (verticalLength - verticalLine) / 2,
    justifyContent: "center",
    transform: [{ rotate: "-90deg" }],
  },
  verticalText: {
    textAlign: "center",
  },
});
