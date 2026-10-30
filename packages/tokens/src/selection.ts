/**
 * Selection controls (SegmentedControl, Switch), sampled from artboards 2 and 3
 * (docs/design/screens/02-new-agent-ticket.png, 03-ticket-drill-in.png):
 *
 * - `track`: the grey segmented track ("Sprint 42 / Search / No ticket", Effort, the drill-in
 *   model switcher); the stage-gates list uses the same grey for its row dividers.
 * - `label`: unselected segment and effort-pill labels, and the switch side text ("Auto",
 *   "Needs approval"). Meets 4.5:1 on `track` and on the surface.
 * - `switchOff`: the switch track when off (on is `color.claude`). The state is the knob and the
 *   word, so the track itself stays under 3:1 (D291).
 * - `thumb`: the raised thumb of the selected segment and tab. White in light; in dark a lift
 *   above the track, so the light labels still read on it.
 * - `thumbShadow`: the thumb's and the switch knob's shadow.
 * - `pillShadow`: the soft violet glow under the selected effort pill.
 * - `disabledOpacity`: a disabled segment or switch fades back.
 */

import { keysOf, varsFor } from './palette';

export const lightSelection = {
  track: '#EEF2F7',
  thumb: '#FFFFFF',
  label: '#475569',
  switchOff: '#CBD5E1',
  thumbShadow: '0 1px 2px rgba(15, 27, 45, 0.1), 0 1px 3px rgba(15, 27, 45, 0.08)',
  pillShadow: '0 2px 8px rgba(91, 75, 196, 0.28)',
} as const;

export const darkSelection = {
  track: '#243044',
  thumb: '#36455C',
  label: '#C5D2E2',
  switchOff: '#4A5E78',
  thumbShadow: '0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.28)',
  pillShadow: '0 2px 8px rgba(91, 101, 196, 0.45)',
} as const;

export type SelectionPalette = Record<keyof typeof lightSelection, string>;

export const solarpunkSelection: SelectionPalette = {
  track: '#ECE7D8',
  thumb: '#FFFFFF',
  label: '#4E5A4A',
  switchOff: '#C9C2AE',
  thumbShadow: '0 1px 2px rgba(31, 42, 30, 0.1), 0 1px 3px rgba(31, 42, 30, 0.08)',
  pillShadow: '0 2px 8px rgba(15, 118, 110, 0.28)',
};

export const cyberpunkSelection: SelectionPalette = {
  track: '#1C1A38',
  thumb: '#2C2957',
  label: '#C9C3EA',
  switchOff: '#4B467A',
  thumbShadow: '0 1px 2px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4)',
  pillShadow: '0 2px 8px rgba(247, 47, 208, 0.45)',
};

export const selection = {
  ...varsFor('selection-', keysOf(lightSelection)),
  disabledOpacity: 0.5,
} as const;
