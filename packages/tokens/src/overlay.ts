/**
 * Modal surroundings, sampled from artboards 2 and 5 (docs/design/screens/02-new-agent-ticket.png,
 * 05-connections.png). The modal itself is glass `xl` (`glass`, `radius.modal`).
 *
 * - `scrim`: the pale wash laid over the app behind an open modal. The board fades back without
 *   going dark, and the ground's violet and sky glows still show through the glass.
 * - `scrimBlur`: the blur of the app behind the scrim (px), the `glass.blurSm` step: board cards
 *   turn into soft shapes, as on artboard 2.
 * - `shadow`: the modal's large soft drop shadow, heavier below the panel than above it.
 *
 * Keep in sync with the overlay block in agent-lanes-tokens.css; overlay.test.ts checks it.
 */
export const overlay = {
  scrim: 'rgba(238, 242, 247, 0.55)',
  scrimBlur: 8,
  shadow: '0 24px 72px rgba(15, 27, 45, 0.18)',
} as const;
