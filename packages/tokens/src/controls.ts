/**
 * Button and control values read off the "Design tokens" artboard (docs/design/screens/07-design-tokens.png)
 * and the buttons on artboards 1, 3 and 5.
 *
 * - `ink`: label and icon colour of secondary buttons (Cancel, Replace, Stop, the pause and
 *   Connections icon buttons). Slate 700 in the light palette, between `ink` and `muted`.
 * - `primaryShadow` / `primaryShadowLifted`: the violet glow under a primary button at rest and
 *   under its 3 px hover lift. Other buttons sit flat and take `shadow.lifted` on hover.
 * - `pressedFilter`: darkens any fill while the button is held down.
 * - `disabledOpacity`: disabled controls fade back but keep their shape and colours.
 */

import { lightDark } from './palette';

export const lightControl = {
  ink: '#334155',
  primaryShadow: '0 6px 16px rgba(91, 75, 196, 0.28)',
  primaryShadowLifted: '0 12px 28px rgba(91, 75, 196, 0.34)',
} as const;

export const darkControl = {
  ink: '#D5DEE9',
  primaryShadow: '0 6px 16px rgba(91, 101, 196, 0.45)',
  primaryShadowLifted: '0 12px 28px rgba(91, 101, 196, 0.55)',
} as const;

export type ControlPalette = Record<keyof typeof lightControl, string>;

export const solarpunkControl: ControlPalette = {
  ink: '#3B4A38',
  primaryShadow: '0 6px 16px rgba(15, 118, 110, 0.28)',
  primaryShadowLifted: '0 12px 28px rgba(15, 118, 110, 0.34)',
};

export const control = {
  ink: lightDark(lightControl.ink, darkControl.ink),
  primaryShadow: `0 6px 16px ${lightDark('rgba(91, 75, 196, 0.28)', 'rgba(91, 101, 196, 0.45)')}`,
  primaryShadowLifted: `0 12px 28px ${lightDark('rgba(91, 75, 196, 0.34)', 'rgba(91, 101, 196, 0.55)')}`,
  pressedFilter: 'brightness(0.94)',
  disabledOpacity: 0.5,
} as const;
