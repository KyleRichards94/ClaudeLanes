/**
 * Modal surroundings, sampled from artboards 2 and 5 (docs/design/screens/02-new-agent-ticket.png,
 * 05-connections.png). The modal itself is glass `xl` (`glass`, `radius.modal`).
 *
 * - `scrim`: the wash laid over the app behind an open modal. In the light palette it stays pale,
 *   so the ground's violet and sky glows still show through the glass. Dark mode dims without
 *   covering the moving ground.
 * - `scrimBlur`: the blur of the app behind the scrim (px), the `glass.blurSm` step: board cards
 *   turn into soft shapes, as on artboard 2.
 * - `shadow`: the modal's large soft drop shadow, heavier below the panel than above it.
 */

import { keysOf, varsFor } from './palette';

export const lightOverlay = {
  scrim: 'rgba(238, 242, 247, 0.55)',
  shadow: '0 24px 72px rgba(15, 27, 45, 0.18)',
} as const;

export const darkOverlay = {
  scrim: 'rgba(8, 12, 18, 0.55)',
  shadow: '0 24px 72px rgba(0, 0, 0, 0.5)',
} as const;

export type OverlayPalette = Record<keyof typeof lightOverlay, string>;

export const solarpunkOverlay: OverlayPalette = {
  scrim: 'rgba(247, 241, 224, 0.58)',
  shadow: '0 24px 72px rgba(110, 76, 24, 0.12), -26px 32px 60px rgba(110, 76, 24, 0.16), 0 0 0 1px rgba(206, 160, 72, 0.35)',
};

export const cyberpunkOverlay: OverlayPalette = {
  scrim: 'rgba(3, 3, 8, 0.66)',
  shadow: '0 24px 72px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 240, 255, 0.35), 0 0 28px rgba(0, 240, 255, 0.22)',
};

export const overlay = {
  ...varsFor('overlay-', keysOf(lightOverlay)),
  scrimBlur: 8,
} as const;
