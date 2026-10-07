import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { WorkItem } from '@agent-lanes/contracts';
import { radius, space, tone } from '@agent-lanes/tokens';
import { IdChip, Text } from '@agent-lanes/ui';
import { stateCategoryTone, workItemSummary } from '../model/work-item';

export interface WorkItemChipProps {
  item: Pick<WorkItem, 'id' | 'title' | 'type' | 'state' | 'stateCategory'>;
  /** Shows the title after the id (lists); off where the title is already the heading. */
  showTitle?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * An Azure DevOps work item in one line (design §5 entities; artboards 2 and 3): the blue id chip,
 * the title, and "Story · Active" with a dot in the state's colour. The state is always in words.
 */
export function WorkItemChip({ item, showTitle = true, style, testID }: WorkItemChipProps) {
  const summary = workItemSummary(item);
  const dot = tone[stateCategoryTone(item.stateCategory)].dot;

  return (
    <View
      style={[styles.row, style]}
      role="group"
      aria-label={`Work item ${item.id}${showTitle ? `, ${item.title}` : ''}, ${summary}`}
      testID={testID}
    >
      <IdChip id={item.id} />
      {showTitle ? (
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {item.title}
        </Text>
      ) : null}
      <View style={styles.state}>
        <View aria-hidden style={[styles.dot, { backgroundColor: dot }]} />
        <Text variant="meta" numberOfLines={1}>
          {summary}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
});
