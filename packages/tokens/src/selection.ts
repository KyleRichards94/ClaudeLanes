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
 * - `thumbShadow`: the raised thumb of the selected segment and the switch knob.
 * - `pillShadow`: the soft violet glow under the selected effort pill.
 * - `disabledOpacity`: a disabled segment or switch fades back.
 *
 * The light hex stays in sync with the selection block in agent-lanes-tokens.css.
 */

import { lightDark } from './palette';

export const lightSelection = {
  track: '#EEF2F7',
  label: '#475569',
  switchOff: '#CBD5E1',
  thumbShadow: '0 1px 2px rgba(15, 27, 45, 0.1), 0 1px 3px rgba(15, 27, 45, 0.08)',
  pillShadow: '0 2px 8px rgba(91, 75, 196, 0.28)',
} as const;

export const darkSelection = {
  track: '#243044',
  label: '#C5D2E2',
  switchOff: '#4A5E78',
  thumbShadow: '0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.28)',
  pillShadow: '0 2px 8px rgba(91, 101, 196, 0.45)',
} as const;

export const selection = {
  track: lightDark(lightSelection.track, darkSelection.track),
  label: lightDark(lightSelection.label, darkSelection.label),
  switchOff: lightDark(lightSelection.switchOff, darkSelection.switchOff),
  thumbShadow: `0 1px 2px ${lightDark('rgba(15, 27, 45, 0.1)', 'rgba(0, 0, 0, 0.35)')}, 0 1px 3px ${lightDark('rgba(15, 27, 45, 0.08)', 'rgba(0, 0, 0, 0.28)')}`,
  pillShadow: `0 2px 8px ${lightDark('rgba(91, 75, 196, 0.28)', 'rgba(91, 101, 196, 0.45)')}`,
  disabledOpacity: 0.5,
} as const;
