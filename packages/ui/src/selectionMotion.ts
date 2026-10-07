import type { ViewStyle } from 'react-native';

/**
 * Transitions for the selection controls (SegmentedControl, Switch). React Native has no CSS
 * transitions, so a native build snaps between states; `selectionMotion.web.ts` eases them on web.
 */
export interface SelectionMotion {
  /** The switch knob sliding between off and on. */
  knob: ViewStyle;
  /** The switch track changing colour. */
  track: ViewStyle;
  /** A segment's thumb or pill filling in when selected. */
  segment: ViewStyle;
}

export const selectionMotion: SelectionMotion = { knob: {}, track: {}, segment: {} };
