/**
 * Agent Lanes design tokens (design §11 and the "Design tokens" artboard).
 * Soft corporate: cool pale ground, white rounded cards, light liquid glass,
 * violet for Claude activity, blue for Azure DevOps. Dark mode keeps that palette
 * and sets it on a blue-black ground (`palette.ts`).
 *
 * Glass recipe adapted from "Pure CSS Glassmorphism Liquid Glass UI Kit"
 * by Margarita-the-solid on CodePen. Keep this credit with the tokens.
 *
 * Paintable colours are `light-dark()` pairs. The hex palettes stay in `palette.ts`
 * and match agent-lanes-tokens.css; tokens.test.ts checks the two agree.
 */

import { darkColor, lightColor, lightDark, themedColors } from './palette';
import { darkGlass, lightGlass } from './surfaces';

export { cssVar, darkColor, kebab, keysOf, lightColor, lightOf, solarpunkColor, varsFor, type ColorPalette, type PaletteColor } from './palette';
export { darkGlass, darkShadow, lightGlass, lightShadow, solarpunkGlass, solarpunkShadow, type GlassPalette, type ShadowPalette } from './surfaces';

export const color = themedColors(lightColor, darkColor);

export type ColorToken = keyof typeof color;

export const glass = {
  /** Fill opacity range for glass surfaces. */
  fillMin: lightDark(lightGlass.fillMin, darkGlass.fillMin),
  fillMax: lightDark(lightGlass.fillMax, darkGlass.fillMax),
  /** Chips and toolbar buttons. */
  blurSm: 8,
  /** Panels, header, live dock. */
  blurMd: 18,
  /** Modals and sheets. */
  blurXl: 40,
  highlight: lightDark(lightGlass.highlight, darkGlass.highlight),
  border: lightDark(lightGlass.border, darkGlass.border),
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

export const shadow = {
  card: `0 1px 2px ${lightDark('rgba(15, 27, 45, 0.04)', 'rgba(0, 0, 0, 0.28)')}, 0 8px 24px ${lightDark('rgba(15, 27, 45, 0.06)', 'rgba(0, 0, 0, 0.35)')}`,
  lifted: `0 2px 4px ${lightDark('rgba(15, 27, 45, 0.06)', 'rgba(0, 0, 0, 0.32)')}, 0 16px 40px ${lightDark('rgba(15, 27, 45, 0.10)', 'rgba(0, 0, 0, 0.45)')}`,
} as const;

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
