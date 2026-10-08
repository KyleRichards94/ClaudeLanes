import { StyleSheet, View } from 'react-native';
import { color, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import { useActiveDrag } from '../model/drag-store';

/** The card under the pointer while it is dragged: its id and title on a lifted white card. */
export function DragPreview() {
  const active = useActiveDrag();
  if (!active) return null;
  return (
    <View style={styles.card} testID="drag-preview">
      <View style={styles.chip}>
        <Text variant="mono" size="xs" color={tone.neutral.text}>
          {active.card.label}
        </Text>
      </View>
      <Text variant="title" numberOfLines={2}>
        {active.card.title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 220,
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.claude,
    backgroundColor: color.surface,
    boxShadow: shadow.lifted,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.chip,
    backgroundColor: tone.neutral.band,
  },
});
