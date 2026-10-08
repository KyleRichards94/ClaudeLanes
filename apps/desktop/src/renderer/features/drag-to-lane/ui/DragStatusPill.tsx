import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import { useActiveDrag } from '../model/drag-store';
import { dragStatusText } from '../model/lane-state';

/** "Drop !10571 on a highlighted lane" by the board's title while a card is dragged (artboard 09); nothing otherwise. */
export function DragStatusPill() {
  const active = useActiveDrag();
  if (!active) return null;
  return (
    <View style={styles.pill} testID="drag-status">
      <View aria-hidden style={styles.arrow}>
        <Icon name="arrow-right" size={14} color={color.surface} />
      </View>
      <Text variant="title" color={color.surface}>
        {dragStatusText(active)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 32,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.claude,
  },
  // Artboard 09's arrow points up, at the lanes.
  arrow: {
    transform: [{ rotate: '-90deg' }],
  },
});
