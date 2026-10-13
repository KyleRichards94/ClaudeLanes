import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { TabPanel } from '@agent-lanes/ui';

/** The right rail's width beside the diff (handoff: `minmax(0, .95fr) minmax(0, 1.25fr) 330px`). */
export const RAIL_WIDTH = 330;
/** The output and diff columns' share of the row, as the handoff's fractions. */
export const OUTPUT_FRACTION = 0.95;
export const DIFF_FRACTION = 1.25;

export interface FlightDeckProps {
  /** The window is wide enough for the rail beside the diff; below that it moves under it and the page scrolls. */
  wide: boolean;
  /** How tall the output and diff columns each are once the page scrolls as a whole. */
  stackedHeight: number;
  /** The tab on show. Output & diff shows the three columns; Build log and ADO take their place. */
  tab: string;
  /** Ties the panel to the tab bar (`tabPanelId`). */
  tabIdPrefix: string;
  /** The workflow card, with the turn strip and the notices that need the user. */
  workflow: ReactNode;
  /** The tab bar, with Hide / Show diff and the agent switcher. */
  tabs: ReactNode;
  /** The output column: the grouped stream with the composer pinned under it. */
  output: ReactNode;
  /** The diff column: the change map and the selected file's diff. */
  diff: ReactNode;
  /** Whether the diff column is shown (Hide diff gives the output the whole width). */
  diffShown: boolean;
  /** The Build log or ADO panel, for the tabs that are not Output & diff. */
  other: ReactNode;
  /** The right rail's cards: Create PR, Agents, Worktree, Merge, Sub-branches. */
  rail: ReactNode;
}

/**
 * The Flight deck frame (handoff "Flight deck layout"): the workflow card, the tab bar, then the body: the output
 * and the diff side by side (`.95fr` and `1.25fr`) and the 330 px right rail. Below 1200 px the rail moves under the
 * columns and the page scrolls, each column then a fixed height. The pieces are slots, so the page keeps the state
 * and the widgets stay presentational.
 */
export function FlightDeck({ wide, stackedHeight, tab, tabIdPrefix, workflow, tabs, output, diff, diffShown, other, rail }: FlightDeckProps) {
  const split = tab === 'output' || tab === 'diff';
  const panel = (
    <TabPanel idPrefix={tabIdPrefix} value={tab} style={[styles.panel, split ? styles.split : styles.card, wide ? styles.panelWide : null, wide && split ? styles.splitWide : null]} testID="ticket-tab-panel">
      {split ? (
        wide ? (
          <>
            <View style={[styles.column, { flexGrow: OUTPUT_FRACTION }]}>{output}</View>
            {diffShown ? <View style={[styles.column, { flexGrow: DIFF_FRACTION }]}>{diff}</View> : null}
          </>
        ) : (
          <>
            <View style={{ height: stackedHeight }}>{output}</View>
            {diffShown ? <View style={{ height: stackedHeight }}>{diff}</View> : null}
          </>
        )
      ) : (
        other
      )}
    </TabPanel>
  );

  return (
    <View style={wide ? styles.root : styles.rootStacked} testID="flight-deck">
      {workflow}
      {tabs}
      {wide ? (
        <View style={styles.bodyWide} testID="ticket-body-wide">
          {panel}
          <ScrollView style={styles.rail} contentContainerStyle={styles.railContent} testID="ticket-side-column">
            {rail}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.bodyStacked} testID="ticket-body-stacked">
          {panel}
          <View style={styles.railContent} testID="ticket-side-column">
            {rail}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    gap: space.md,
  },
  rootStacked: {
    gap: space.md,
  },
  bodyWide: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.md,
  },
  bodyStacked: {
    gap: space.md,
  },
  panel: {
    minWidth: 0,
  },
  // Output & diff: two columns that are cards of their own.
  split: {
    gap: space.md,
  },
  // Build log and ADO: one card.
  card: {
    overflow: 'hidden',
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
  },
  panelWide: {
    flex: 1,
    minHeight: 0,
  },
  splitWide: {
    flexDirection: 'row',
  },
  column: {
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
  },
  rail: {
    width: RAIL_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  railContent: {
    gap: space.md,
    paddingBottom: space.md,
  },
});
