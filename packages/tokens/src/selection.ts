/**
 * Selection controls (SegmentedControl, Switch), sampled from artboards 2 and 3
 * (docs/design/screens/02-new-agent-ticket.png, 03-ticket-drill-in.png):
 *
 * - `track`: the grey segmented track ("Sprint 42 / Search / No ticket", Effort, the drill-in
 *   model switcher); the stage-gates list uses the same grey for its row dividers.
 * - `label`: unselected segment and effort-pill labels, and the switch side text ("Auto",
 *   "Needs approval"). Meets 4.5:1 on `track` and on white.
 * - `switchOff`: the switch track when off (on is `color.claude`).
 * - `thumbShadow`: the raised white thumb of the selected segment and the switch knob.
 * - `pillShadow`: the soft violet glow under the selected effort pill.
 * - `disabledOpacity`: a disabled segment or switch fades back.
 *
 * Keep in sync with the selection block in agent-lanes-tokens.css; selection.test.ts checks it.
 */
export const selection = {
  track: '#EEF2F7',
  label: '#475569',
  switchOff: '#CBD5E1',
  thumbShadow: '0 1px 2px rgba(15, 27, 45, 0.1), 0 1px 3px rgba(15, 27, 45, 0.08)',
  pillShadow: '0 2px 8px rgba(91, 75, 196, 0.28)',
  disabledOpacity: 0.5,
} as const;
