import { LANES } from '@agent-lanes/contracts';
import { ScrollView, StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { COLLAPSED_LANE_WIDTH, LANE_MIN_WIDTH, Lane } from './Lane';

/** Six lanes at their narrowest, the Done strip and the gaps: below this the row scrolls sideways. */
export const LANES_MIN_WIDTH = (LANES.length - 1) * LANE_MIN_WIDTH + COLLAPSED_LANE_WIDTH + (LANES.length - 1) * space.md;

/**
 * The board's lanes, left to right: Queued, Planning, Implementing, Code review, QA, Create PR, then
 * Done (collapsed to a strip by default). With `needsYouOnly` each lane shows only its cards that need the user. They share the width; in a narrower window the row keeps
 * its minimum width and scrolls horizontally (artboard 1).
 */
export function BoardLanes({ store = agentTickets, needsYouOnly = false }: { store?: AgentTicketStore; needsYouOnly?: boolean }) {
  return (
    <ScrollView
      horizontal
      testID="board-lanes"
      style={styles.scroller}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator
    >
      <View style={styles.row}>
        {LANES.map((lane) => (
          <Lane key={lane} lane={lane} store={store} needsYouOnly={needsYouOnly} />
        ))}
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
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    // Room under the lanes for the horizontal scrollbar when it shows.
    paddingBottom: space.sm,
  },
});
