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
  track: '#F0E6CC',
  thumb: '#FFFCF3',
  label: '#4C5844',
  switchOff: '#CDBF9A',
  thumbShadow: '-1px 2px 3px rgba(120, 84, 30, 0.16), -3px 5px 9px rgba(120, 84, 30, 0.1)',
  pillShadow: '-3px 5px 12px rgba(45, 122, 62, 0.28)',
};

export const cyberpunkSelection: SelectionPalette = {
  track: '#1A1838',
  thumb: '#2E2A5E',
  label: '#C9C3EA',
  switchOff: '#4B467A',
  thumbShadow: '0 0 0 1px rgba(0, 240, 255, 0.35), 0 0 10px rgba(0, 240, 255, 0.25)',
  pillShadow: '0 0 10px rgba(255, 43, 214, 0.6), 0 0 22px rgba(255, 43, 214, 0.3)',
};

export const selection = {
  ...varsFor('selection-', keysOf(lightSelection)),
  disabledOpacity: 0.5,
} as const;
