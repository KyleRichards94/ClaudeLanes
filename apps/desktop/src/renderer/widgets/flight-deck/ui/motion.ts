import type { ViewStyle } from 'react-native';

/**
 * Motion for the deck (pulsing live dots and running segments, the indeterminate progress shimmer). react-native-web
 * turns `animationKeyframes` into a CSS animation; the style types do not know it. Callers leave these out under
 * `prefers-reduced-motion` (`usePrefersReducedMotion`).
 */
export const pulseStyle = {
  animationKeyframes: { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
  animationDuration: '1.6s',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} as unknown as ViewStyle;

/** A block that slides across its track, left to right. */
export const shimmerStyle = {
  animationKeyframes: { '0%': { transform: [{ translateX: '-100%' }] }, '100%': { transform: [{ translateX: '250%' }] } },
  animationDuration: '1.4s',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} as unknown as ViewStyle;

/** A style key react-native's types do not list but react-native-web passes through (gradients, shadows). */
export function web(style: Record<string, string | number>): ViewStyle {
  return style as unknown as ViewStyle;
}
