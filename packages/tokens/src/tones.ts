/**
 * Tone tints read off the "Agent card states" artboard (docs/design/screens/06-card-states.png):
 * card borders, the tinted card body, status footer bands and progress fills.
 *
 * - `border`: card outline for that state (selected violet, attention amber, danger red).
 * - `wash`: the faint tint behind a card's activity section.
 * - `band`: footer band and status-pill background.
 * - `text`: text on a `band` (meets 4.5:1 on it).
 * - `fill`: progress bar fill (claude is a gradient, see `progressGradient`).
 *
 * Values that repeat a `color` token are spelled out rather than imported, because index.ts
 * re-exports this file (an import back would be circular); tones.test.ts checks they still match.
 * Keep in sync with the tone block in agent-lanes-tokens.css; tones.test.ts checks that too.
 */
export const tone = {
  claude: {
    border: '#8B80E0',
    wash: '#F6F5FF',
    band: '#EEEBFF', // color.claudeTint
    text: '#4A3BB0', // color.claudeText
  },
  ado: {
    wash: '#F0F9FF',
    band: '#E0F2FE', // color.adoTint
    text: '#0369A1', // color.ado
    fill: '#38BDF8', // color.skyGlow
  },
  attention: {
    border: '#FCD34D',
    band: '#FEF3C7',
    text: '#92400E',
  },
  danger: {
    border: '#FECACA',
    wash: '#FEF2F2',
    band: '#FEE2E2',
    text: '#991B1B',
    fill: '#F87171',
  },
  ok: {
    wash: '#ECFDF5',
    band: '#D1FAE5',
    text: '#047857',
    fill: '#10B981',
  },
} as const;

export type Tone = keyof typeof tone;

/** Running progress: Claude violet into the sky glow, left to right. */
export const progressGradient = {
  from: '#5B4BC4', // color.claude
  to: '#38BDF8', // color.skyGlow
} as const;

/** Merged and other finished cards fade back so live work stands out. */
export const mutedOpacity = 0.75;
