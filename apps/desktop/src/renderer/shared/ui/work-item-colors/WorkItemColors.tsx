import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, radius, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';

/**
 * Azure DevOps' type and state colours on a card (bar and dot beside words, never text on the raw
 * colour, so contrast holds whatever the process picks). Null colours fall back to the tokens: the
 * ADO blue for a type, the neutral grey for a state.
 */
export const FALLBACK_TYPE_COLOR = tone.ado.dot;
export const FALLBACK_STATE_COLOR = tone.neutral.dot;

export interface WorkItemTypeBarProps {
  /** `#RRGGBB` from `ado:workItemColors`; null uses the token colour. */
  typeColor: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A 3 × 16 px bar in the work item type's colour, beside the `#id` chip. Decorative: the type is also in words. */
export function WorkItemTypeBar({ typeColor, style, testID }: WorkItemTypeBarProps) {
  return <View aria-hidden testID={testID} style={[styles.bar, { backgroundColor: typeColor ?? FALLBACK_TYPE_COLOR }, style]} />;
}

export interface WorkItemStateLabelProps {
  /** `System.State` ("Active", "Failed UAT"). */
  state: string;
  /** `#RRGGBB` from `ado:workItemColors`; null uses the token colour. */
  stateColor: string | null;
  testID?: string;
}

/** The state in words after a dot in its ADO colour ("● Active"). */
export function WorkItemStateLabel({ state, stateColor, testID }: WorkItemStateLabelProps) {
  return (
    <View style={styles.state} testID={testID}>
      <View aria-hidden testID={testID ? `${testID}-dot` : undefined} style={[styles.dot, { backgroundColor: stateColor ?? FALLBACK_STATE_COLOR }]} />
      <Text variant="meta" size="xs" numberOfLines={1} style={styles.stateText}>
        {state}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: 3,
    height: 16,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    flexShrink: 0,
    // A hairline so a white or pale state colour (ADO's "Removed") still reads on a white card.
    borderWidth: 1,
    borderColor: color.line,
  },
  stateText: {
    flexShrink: 1,
  },
});
