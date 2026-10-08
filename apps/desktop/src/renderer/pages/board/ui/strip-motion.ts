import type { ViewStyle } from 'react-native';

/**
 * How the collapsed agent board eases in and out. React Native has no CSS transitions, so a native
 * build switches instantly; `strip-motion.web.ts` fades and slides it on web.
 */
export function stripTransition(_reducedMotion: boolean): ViewStyle | null {
  return null;
}
