import type { Lane } from '@agent-lanes/contracts';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import { color, glass, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import { LANE_LABELS } from '@/entities/agent-ticket';
import { allowedLaneList, dragLabel } from '../model/lane-state';
import type { LaneDragCard } from '../model/types';

/** Where the menu opens: under the card, or over it when there is no room below. */
export interface MenuAnchor {
  x: number;
  top: number;
  bottom: number;
  width: number;
}

const MENU_WIDTH = 300;
const HEADER_HEIGHT = 36;
const ITEM_HEIGHT = 64;

interface Focusable {
  focus(): void;
}

/**
 * "Send to lane" (TB§7): Enter on a focused team board card opens this menu of the lanes that take
 * it, each with what the drop does, from the same rules as dragging. Up and Down move between them,
 * Enter or Space sends the card, Escape or a press outside closes it and focus goes back to the card.
 */
export function SendToLaneMenu({
  card,
  anchor,
  onClose,
  onChoose,
}: {
  card: LaneDragCard;
  anchor: MenuAnchor | null;
  onClose(): void;
  onChoose(lane: Lane): void;
}) {
  const lanes = allowedLaneList(card);
  const items = useRef<(Focusable | null)[]>([]);
  const [focused, setFocused] = useState(0);

  // Focus starts on the first lane, so Enter twice sends the card to it.
  useEffect(() => {
    if (!anchor) return;
    const timer = setTimeout(() => items.current[0]?.focus(), 0);
    return () => clearTimeout(timer);
  }, [anchor]);

  const move = (step: number) => {
    if (lanes.length === 0) return;
    const next = (focused + step + lanes.length) % lanes.length;
    setFocused(next);
    items.current[next]?.focus();
  };
  const keys = {
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      }
    },
  } as unknown as ViewProps;

  const height = HEADER_HEIGHT + Math.max(lanes.length, 1) * ITEM_HEIGHT + space.sm;
  const window = Dimensions.get('window');
  const below = anchor ? anchor.bottom + space.xs : 0;
  const top = anchor && below + height > window.height ? Math.max(space.sm, anchor.top - space.xs - height) : below;
  const left = anchor ? Math.max(space.sm, Math.min(anchor.x, window.width - MENU_WIDTH - space.sm)) : 0;

  return (
    <Modal transparent visible={anchor !== null} onRequestClose={onClose} animationType="none">
      {anchor ? (
        <View
          role="menu"
          aria-label={`Send ${dragLabel(card)} to a lane`}
          style={[styles.menu, { top, left, width: MENU_WIDTH }]}
          testID="send-to-lane-menu"
          {...keys}
        >
          <Text variant="meta" style={styles.heading}>
            {`Send ${dragLabel(card)} to`}
          </Text>
          {lanes.length === 0 ? (
            <Text variant="body" style={styles.empty}>
              No lane takes this card.
            </Text>
          ) : (
            lanes.map(({ lane, action }, index) => (
              <Pressable
                key={lane}
                ref={(node) => {
                  items.current[index] = node as unknown as Focusable | null;
                }}
                role="menuitem"
                aria-label={`${LANE_LABELS[lane]}: ${action.label}. ${action.detail}`}
                onPress={() => onChoose(lane)}
                onFocus={() => setFocused(index)}
                onHoverIn={() => setFocused(index)}
                style={[styles.item, focused === index && styles.itemActive]}
                testID={`send-to-lane-${lane}`}
              >
                <Text variant="title">{LANE_LABELS[lane]}</Text>
                <Text variant="meta" size="sm" numberOfLines={1} color={tone.claude.text}>
                  {action.title}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
      {/* After the menu, so focus lands on the menu first; under it on screen. */}
      <Pressable aria-label="Close the Send to lane menu" style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    zIndex: 0,
  },
  menu: {
    position: 'absolute',
    zIndex: 1,
    paddingBottom: space.xs,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: glass.border,
    backgroundColor: color.surface,
    boxShadow: shadow.lifted,
  },
  heading: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  empty: {
    padding: space.md,
  },
  item: {
    justifyContent: 'center',
    gap: 2,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  itemActive: {
    backgroundColor: color.claudeTint,
  },
});
