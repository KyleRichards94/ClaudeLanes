import { StyleSheet, type ViewStyle } from 'react-native';
import { motion } from '@agent-lanes/tokens';
import type { SelectionMotion } from './selectionMotion';

/**
 * Web: ease the selection controls between states with the design's fast ease-out (§11 Motion).
 * react-native-web passes CSS transition properties through to the DOM; React Native's style types
 * don't list them, hence the cast.
 */
function transition(property: string): ViewStyle {
  return {
    transitionProperty: property,
    transitionDuration: `${motion.fastMs}ms`,
    transitionTimingFunction: motion.easing,
  } as unknown as ViewStyle;
}

export const selectionMotion: SelectionMotion = StyleSheet.create({
  knob: transition('transform'),
  track: transition('background-color'),
  segment: transition('background-color, border-color, box-shadow'),
});
