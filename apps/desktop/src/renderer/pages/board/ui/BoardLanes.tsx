import { PIPELINE_LANES, SOLO_LANES } from '@agent-lanes/contracts';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { COLLAPSED_LANE_WIDTH, LANE_MIN_WIDTH, Lane } from './Lane';

/** Six lanes at their narrowest, the Done strip and the gaps: below this the row scrolls sideways. */
export const LANES_MIN_WIDTH = (PIPELINE_LANES.length - 1) * LANE_MIN_WIDTH + COLLAPSED_LANE_WIDTH + (PIPELINE_LANES.length - 1) * space.md;

/**
 * The board's lanes. On top, the single-step lanes (Code review only, QA only, Create PR only), where
 * the agent does that one step and stops. Under them the workflow, left to right: Queued, Planning,
 * Implementing, Code review, QA, Create PR, then Done (collapsed to a strip by default). With
 * `needsYouOnly` each lane shows only its cards that need the user. They share the width; in a
 * narrower window the rows keep their minimum width and scroll horizontally (artboard 1).
 */
export interface BoardLanesProps {
  store?: AgentTicketStore;
  needsYouOnly?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function BoardLanes({ store = agentTickets, needsYouOnly = false, onLayout }: BoardLanesProps) {
  return (
    <ScrollView
      horizontal
      testID="board-lanes"
      onLayout={onLayout}
      style={styles.scroller}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator
    >
      <View style={styles.rows}>
        <View style={styles.group} role="group" aria-label="Single-step lanes" testID="board-solo-lanes">
          <Text variant="meta" color={color.muted}>
            Single step · the agent does only this, then stops
          </Text>
          <View style={styles.row}>
            {SOLO_LANES.map((lane) => (
              <Lane key={lane} lane={lane} store={store} needsYouOnly={needsYouOnly} />
            ))}
          </View>
        </View>
        <View style={styles.group} role="group" aria-label="Workflow lanes">
          <Text variant="meta" color={color.muted}>
            Workflow · Queued → Plan → Implement → Code review → QA → Create PR
          </Text>
          <View style={styles.row}>
            {PIPELINE_LANES.map((lane) => (
              <Lane key={lane} lane={lane} store={store} needsYouOnly={needsYouOnly} />
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: {
    flexGrow: 0,
  },
  // As wide as the board, but never narrower than the lanes need: then it scrolls.
  content: {
    width: '100%',
    minWidth: LANES_MIN_WIDTH,
  },
  rows: {
    flex: 1,
    gap: space.lg,
    // Room under the lanes for the horizontal scrollbar when it shows.
    paddingBottom: space.sm,
  },
  group: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
});
