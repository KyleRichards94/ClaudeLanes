/**
 * Agent Lanes design tokens (design §11 and the "Design tokens" artboard).
 * Soft corporate: cool pale ground, white rounded cards, light liquid glass,
 * violet for Claude activity, blue for Azure DevOps.
 *
 * Glass recipe adapted from "Pure CSS Glassmorphism Liquid Glass UI Kit"
 * by Margarita-the-solid on CodePen. Keep this credit with the tokens.
 *
 * Keep in sync with agent-lanes-tokens.css; tokens.test.ts checks the two agree.
 */

export const color = {
  bg: '#F4F7FB',
  surface: '#FFFFFF',
  ink: '#0F1B2D',
  muted: '#5B6B82',
  line: '#E2E8F0',
  claude: '#5B4BC4',
  claudeTint: '#EEEBFF',
  claudeText: '#4A3BB0',
  ado: '#0369A1',
  adoTint: '#E0F2FE',
  ok: '#059669',
  attention: '#D97706',
  danger: '#B91C1C',
  skyGlow: '#38BDF8',
} as const;

export type ColorToken = keyof typeof color;

export const glass = {
  /** White fill opacity range for glass surfaces. */
  fillMin: 'rgba(255, 255, 255, 0.62)',
  fillMax: 'rgba(255, 255, 255, 0.72)',
  /** Chips and toolbar buttons. */
  blurSm: 8,
  /** Panels, header, live dock. */
  blurMd: 18,
  /** Modals and sheets. */
  blurXl: 40,
  highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  border: 'rgba(255, 255, 255, 0.7)',
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
  card: '0 1px 2px rgba(15, 27, 45, 0.04), 0 8px 24px rgba(15, 27, 45, 0.06)',
  lifted: '0 2px 4px rgba(15, 27, 45, 0.06), 0 16px 40px rgba(15, 27, 45, 0.10)',
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
