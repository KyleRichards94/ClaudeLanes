/**
 * Agent Lanes design tokens (design §11 and the "Design tokens" artboard).
 * Paintable tokens are `var(--al-*)` references; each theme fills them in from its block in
 * agent-lanes-tokens.css. The hex palettes live in themes.ts.
 * Glass recipe adapted from "Pure CSS Glassmorphism Liquid Glass UI Kit"
 * by Margarita-the-solid on CodePen. Keep this credit with the tokens.
 */

import { cssVar, keysOf, lightColor, varsFor } from './palette';
import { lightGlass, lightShadow } from './surfaces';

export { cssVar, cyberpunkColor, darkColor, kebab, keysOf, lightColor, solarpunkColor, varsFor, type ColorPalette, type PaletteColor } from './palette';
export { cyberpunkGlass, cyberpunkShadow, darkGlass, darkShadow, lightGlass, lightShadow, solarpunkGlass, solarpunkShadow, type GlassPalette, type ShadowPalette } from './surfaces';

/** Paintable colours: `var(--al-*)` references, which the theme's block in agent-lanes-tokens.css fills in. */
export const color = varsFor('', keysOf(lightColor));

export type ColorToken = keyof typeof color;

export const glass = {
  ...varsFor('glass-', keysOf(lightGlass)),
  /** Chips and toolbar buttons. */
  blurSm: 8,
  /** Panels, header, live dock. */
  blurMd: 18,
  /** Modals and sheets. */
  blurXl: 40,
} as const;

export type GlassLevel = 'sm' | 'md' | 'xl';

export const radius = {
  chip: 8,
  control: 12,
  card: 16,
  panel: 20,
  modal: 28,
  pill: 999,
} as const;

export const font = {
  sans: '"Plus Jakarta Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const fontWeight = {
  body: '500',
  heading: '700',
  display: '800',
  mono: '400',
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  display: 40,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const shadow = varsFor('shadow-', keysOf(lightShadow));

export const motion = {
  /** Ease-out 150–220 ms; hover lifts 3 px with a deeper soft shadow. No skew, no hard offset shadows. */
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  fastMs: 150,
  slowMs: 220,
  hoverLiftPx: 3,
} as const;

export const focusRing = {
  color: color.claude,
  width: 2,
  offset: 2,
} as const;

/** Minimum hit target (design §11 accessibility). */
export const minTarget = 44;

export const tokens = { color, glass, radius, font, fontWeight, fontSize, space, shadow, motion, focusRing, minTarget } as const;

export * from './tones';
export * from './selection';
export * from './controls';
export * from './overlay';
export * from './contrast';
export * from './themes';
export * from './glow';

/** Theme scenery painted on surfaces; none in themes without it (agent-lanes-tokens.css). */
export const motif = { card: cssVar('card-motif'), lane: cssVar('lane-motif'), solarCell: cssVar('solar-cell') } as const;
