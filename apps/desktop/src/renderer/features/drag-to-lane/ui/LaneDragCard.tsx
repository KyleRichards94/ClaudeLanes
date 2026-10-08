import type { Lane } from '@agent-lanes/contracts';
import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { announce, getActiveDrag, useIsDragging } from '../model/drag-store';
import { allowedLaneList, sentAnnouncement } from '../model/lane-state';
import type { LaneDragCard as DragCard } from '../model/types';
import { useCardDragBindings } from './card-bindings';
import { useDragToLane, type DragToLaneContextValue } from './context';
import { SendToLaneMenu, type MenuAnchor } from './SendToLaneMenu';

export interface LaneDragCardProps {
  /** The card's drag data; null when it can't be dragged (someone else's item, an agent already on it). */
  drag: DragCard | null;
  /** What a screen reader says for the card: "#71318 Bug, Quote PDF totals round incorrectly, …". */
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}

/**
 * A team board card (or backlog row) that can go to an agent lane (T2, TB§7): picked up with the
 * pointer or with Space, and sent from the keyboard with Enter, which opens the "Send to lane" menu of
 * the lanes that take it. It is a list item either way; one that can't be dragged is only that.
 */
export function LaneDragCard({ drag, label, style, testID, children }: LaneDragCardProps) {
  const context = useDragToLane();
  if (!drag || !context) {
    return (
      <View role="listitem" aria-label={label} style={style} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <View role="listitem" style={styles.item}>
      <DraggableCard drag={drag} context={context} label={label} style={style} testID={testID}>
        {children}
      </DraggableCard>
    </View>
  );
}

interface Measurable {
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
}

function DraggableCard({
  drag,
  context,
  label,
  style,
  testID,
  children,
}: Required<Pick<LaneDragCardProps, 'label' | 'children'>> &
  Pick<LaneDragCardProps, 'style' | 'testID'> & {
    drag: DragCard;
    context: DragToLaneContextValue;
  }) {
  const bindings = useCardDragBindings(drag);
  const dragging = useIsDragging(drag.key);
  const node = useRef<Measurable | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const openMenu = () => {
    const measurable = node.current;
    if (!measurable?.measureInWindow) {
      setAnchor({ x: 0, top: 0, bottom: 0, width: 0 });
      return;
    }
    measurable.measureInWindow((x, y, width, height) => setAnchor({ x, top: y, bottom: y + height, width }));
  };

  const send = (lane: Lane) => {
    setAnchor(null);
    const action = allowedLaneList(drag).find((entry) => entry.lane === lane)?.action;
    if (action) announce(sentAnnouncement(drag, lane, action));
    void context.drop(drag, lane);
  };

  const { onKeyDown: sensorKeyDown, ...listeners } = bindings.listeners;
  // Enter on a resting card opens the menu; while a card is being dragged it drops (the keyboard sensor's).
  const onKeyDown = (event: { key: string; preventDefault(): void }) => {
    if (event.key === 'Enter' && !getActiveDrag()) {
      event.preventDefault();
      openMenu();
      return;
    }
    sensorKeyDown?.(event);
  };

  const domProps = {
    ...bindings.attributes,
    ...listeners,
    onKeyDown,
    role: 'button',
    tabIndex: 0,
    'aria-roledescription': 'draggable card',
    'aria-haspopup': 'menu',
    'aria-expanded': anchor !== null,
    'aria-label': label,
  } as unknown as ViewProps;

  return (
    <>
      <View
        ref={(element) => {
          node.current = element as unknown as Measurable | null;
          bindings.setNodeRef(element);
        }}
        style={[style, styles.draggable, dragging && styles.dragging]}
        testID={testID}
        {...domProps}
      >
        {children}
      </View>
      <SendToLaneMenu card={drag} anchor={anchor} onClose={() => setAnchor(null)} onChoose={send} />
    </>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'column',
  },
  // react-native-web passes the CSS cursor through; React Native's types only know auto and pointer.
  draggable: { cursor: 'grab' } as unknown as ViewStyle,
  // Artboard 09: the card being dragged stays in its column, faded.
  dragging: {
    opacity: 0.5,
  },
});
