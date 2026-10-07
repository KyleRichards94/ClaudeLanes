/**
 * Button and control values read off the "Design tokens" artboard (docs/design/screens/07-design-tokens.png)
 * and the buttons on artboards 1, 3 and 5.
 *
 * - `ink`: label and icon colour of secondary buttons (Cancel, Replace, Stop, the pause and
 *   Connections icon buttons). Slate 700, between `ink` and `muted`.
 * - `primaryShadow` / `primaryShadowLifted`: the violet glow under a primary button at rest and
 *   under its 3 px hover lift. Other buttons sit flat and take `shadow.lifted` on hover.
 * - `pressedFilter`: darkens any fill while the button is held down.
 * - `disabledOpacity`: disabled controls fade back but keep their shape and colours.
 *
 * Keep in sync with the control block in agent-lanes-tokens.css; controls.test.ts checks it.
 */
export const control = {
  ink: '#334155',
  primaryShadow: '0 6px 16px rgba(91, 75, 196, 0.28)',
  primaryShadowLifted: '0 12px 28px rgba(91, 75, 196, 0.34)',
  pressedFilter: 'brightness(0.94)',
  disabledOpacity: 0.5,
} as const;
