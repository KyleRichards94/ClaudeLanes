import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import type { AgentView } from '@/entities/agent';
import type { Turn } from '@/entities/turn';
import { turnSegments, turnTooltip, turnTotalLabel, LIVE_TURN_FILL, TURN_HEIGHT, TURN_MIN_WIDTH } from '../model/turn-strip';
import { HoverHint } from './HoverHint';
import { web } from './motion';

export interface TurnStripProps {
  turns: readonly Turn[];
  agents: readonly AgentView[];
  /** The highlighted turn (`selectedTurn`), 1-based. */
  selectedTurn: number | null;
  /** A turn was pressed: the page selects it and scrolls the output to it. */
  onSelectTurn(index: number): void;
  testID?: string;
}

/**
 * One button per turn (handoff "Flight deck > Workflow card > Turn strip"): as wide as the turn was long in
 * minutes (never under 26 px), filled with the colour of the agent that led it, saying "T3" and its cost. The live
 * turn is the violet gradient. The total, "7 turns · $2.06", sits at the right.
 */
export function TurnStrip({ turns, agents, selectedTurn, onSelectTurn, testID = 'turn-strip' }: TurnStripProps) {
  const segments = turnSegments(turns, agents);
  if (segments.length === 0) return null;
  return (
    <View style={styles.strip} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row} role="list" aria-label="Turns">
        {segments.map((segment) => {
          const turn = turns.find((candidate) => candidate.index === segment.index)!;
          const selected = selectedTurn === segment.index;
          return (
            <HoverHint key={segment.index} hint={turnTooltip(turn, agents)} style={{ flexGrow: segment.grow, flexShrink: 0, flexBasis: TURN_MIN_WIDTH, minWidth: TURN_MIN_WIDTH }}>
              <Pressable
                role="button"
                aria-label={segment.name}
                aria-pressed={selected}
                onPress={() => onSelectTurn(segment.index)}
                style={[
                  styles.turn,
                  segment.fill === null ? web({ backgroundImage: LIVE_TURN_FILL }) : { backgroundColor: segment.fill },
                  segment.live && { backgroundColor: color.claude },
                  selected && styles.selected,
                ]}
                testID={`turn-${segment.index}`}
              >
                <Text variant="body" size="xs" color={segment.ink} numberOfLines={1} style={styles.label}>
                  {segment.label}
                </Text>
                <Text variant="meta" size="xs" color={segment.ink} numberOfLines={1} style={styles.cost}>
                  {segment.cost}
                </Text>
              </Pressable>
            </HoverHint>
          );
        })}
      </ScrollView>
      <Text variant="meta" size="sm" style={styles.total} testID="turn-total">
        {turnTotalLabel(turns)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  scroll: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexGrow: 1,
    flexDirection: 'row',
    gap: 4,
  },
  turn: {
    flex: 1,
    height: TURN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  selected: {
    borderWidth: 2,
    borderColor: color.ink,
  },
  label: {
    fontWeight: '800',
  },
  cost: {
    fontWeight: '600',
    flexShrink: 1,
  },
  total: {
    flexShrink: 0,
    fontWeight: '700',
  },
});
