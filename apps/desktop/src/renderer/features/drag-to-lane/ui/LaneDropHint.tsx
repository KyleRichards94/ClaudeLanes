import type { Lane } from '@agent-lanes/contracts';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import type { LaneDropState } from '../model/lane-state';

/**
 * The lane's own look while a card is dragged (T2, TB§7, artboard 09): a lane that takes the card gets
 * a 2 px violet dashed border (solid while the card is over it), so the change is in the border's
 * style as well as its colour; a lane that refuses it fades.
 */
export function laneDropStyle(state: LaneDropState): ViewStyle | null {
  if (state.kind === 'accept') return state.over ? styles.over : styles.accept;
  if (state.kind === 'refuse') return state.reason ? styles.refusedWithReason : styles.refused;
  return null;
}

/**
 * At the top of a lane while a card is dragged: what dropping it there does ("Answer PR comments ·
 * Checks out …", dashed, artboard 09), or why the lane won't take it when that helps ("No linked PR").
 */
export function LaneDropHint({ lane, state }: { lane: Lane; state: LaneDropState }) {
  if (state.kind === 'accept') {
    return (
      <View style={[styles.hint, state.over && styles.hintOver]} testID={`lane-${lane}-drop-hint`}>
        <Text variant="title" size="sm" color={tone.claude.text}>
          {state.action.title}
        </Text>
        <Text variant="meta" size="sm" color={color.ink}>
          {state.action.detail}
        </Text>
      </View>
    );
  }
  if (state.kind === 'refuse' && state.reason) {
    return (
      <View style={styles.refusal} testID={`lane-${lane}-drop-refusal`}>
        <Icon name="lock" size={12} color={tone.neutral.text} />
        <Text variant="title" size="sm" color={tone.neutral.text} style={styles.flexText}>
          {state.reason}
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  accept: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: color.claude,
  },
  over: {
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: color.claude,
    backgroundColor: tone.claude.wash,
  },
  refused: {
    opacity: 0.45,
  },
  refusedWithReason: {
    opacity: 0.75,
  },
  hint: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: color.claude,
    backgroundColor: color.surface,
  },
  hintOver: {
    backgroundColor: tone.claude.band,
  },
  refusal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: tone.neutral.band,
  },
  flexText: {
    flexShrink: 1,
  },
});
