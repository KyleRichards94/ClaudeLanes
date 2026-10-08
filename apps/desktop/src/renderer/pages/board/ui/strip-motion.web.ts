import type { ViewStyle } from 'react-native';
import { motion } from '@agent-lanes/tokens';

/**
 * Web: the strip fades and slides (opacity and translate) with the design's slow ease-out, 220 ms
 * (§11 Motion). `visibility` transitions with them, so a hiding strip stays visible until it has
 * faded and then leaves the tab order. With reduced motion it switches instantly. React Native's
 * style types don't list CSS transitions, hence the cast.
 */
export function stripTransition(reducedMotion: boolean): ViewStyle | null {
  return {
    transitionProperty: 'opacity, transform, visibility',
    transitionDuration: reducedMotion ? '0ms' : `${motion.slowMs}ms`,
    transitionTimingFunction: motion.easing,
  } as unknown as ViewStyle;
}
