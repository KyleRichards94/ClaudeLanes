/**
 * Tone tints read off the "Agent card states" artboard (docs/design/screens/06-card-states.png):
 * card borders, the tinted card body, status footer bands and progress fills.
 *
 * - `border`: card outline for that state (selected violet, attention amber, danger red).
 * - `wash`: the faint tint behind a card's activity section.
 * - `band`: footer band and status-pill background.
 * - `text`: text on a `band` (meets 4.5:1 on it).
 * - `fill`: progress bar fill (claude is a gradient, see `progressGradient`).
 * - `dot`: the status dot in a pill (the "Status badges" block), the tone's strong colour.
 *
 * `neutral` is the grey of "Queued" and other idle states (status badges on artboard 6, the
 * "1 queued" count on artboard 1).
 */

import { cssVar, cyberpunkColor, darkColor, keysOf, lightColor, solarpunkColor, varsFor } from './palette';

export const lightTone = {
  claude: {
    border: '#8B80E0',
    wash: '#F6F5FF',
    band: lightColor.claudeTint,
    text: lightColor.claudeText,
    dot: lightColor.claude,
  },
  ado: {
    wash: '#F0F9FF',
    band: lightColor.adoTint,
    text: lightColor.ado,
    fill: lightColor.skyGlow,
    dot: lightColor.ado,
  },
  attention: {
    border: '#FCD34D',
    band: '#FEF3C7',
    text: '#92400E',
    dot: lightColor.attention,
  },
  danger: {
    border: '#FECACA',
    wash: '#FEF2F2',
    band: '#FEE2E2',
    text: '#991B1B',
    fill: '#F87171',
    dot: lightColor.danger,
  },
  ok: {
    wash: '#ECFDF5',
    band: '#D1FAE5',
    text: '#047857',
    fill: '#10B981',
    dot: lightColor.ok,
  },
  neutral: {
    band: '#F1F5F9',
    text: '#475569',
    dot: '#94A3B8',
  },
} as const;

export type TonePalette = { [T in keyof typeof lightTone]: { [K in keyof (typeof lightTone)[T]]: string } };

export const darkTone = {
  claude: {
    border: '#A99BF2',
    wash: '#221E3D',
    band: darkColor.claudeTint,
    text: darkColor.claudeText,
    dot: darkColor.claude,
  },
  ado: {
    wash: '#0C2838',
    band: darkColor.adoTint,
    text: darkColor.ado,
    fill: darkColor.skyGlow,
    dot: darkColor.ado,
  },
  attention: {
    border: '#FBBF24',
    band: '#3A2C12',
    text: '#FDE68A',
    dot: darkColor.attention,
  },
  danger: {
    border: '#FCA5A5',
    wash: '#3A1818',
    band: '#4C1F1F',
    text: '#FECACA',
    fill: '#F87171',
    dot: darkColor.danger,
  },
  ok: {
    wash: '#0C2E24',
    band: '#134535',
    text: '#A7F3D0',
    fill: '#34D399',
    dot: darkColor.ok,
  },
  neutral: {
    band: '#243246',
    text: '#D5DEEA',
    dot: '#94A3B8',
  },
} as const satisfies TonePalette;

export const solarpunkTone = {
  claude: {
    border: '#5FB8A6',
    wash: '#EEF8F4',
    band: solarpunkColor.claudeTint,
    text: solarpunkColor.claudeText,
    dot: solarpunkColor.claude,
  },
  ado: {
    wash: '#EEF6FB',
    band: solarpunkColor.adoTint,
    text: solarpunkColor.ado,
    fill: solarpunkColor.skyGlow,
    dot: solarpunkColor.ado,
  },
  attention: {
    border: '#F2C94C',
    band: '#FBF0C8',
    text: '#7A4A00',
    dot: solarpunkColor.attention,
  },
  danger: {
    border: '#F3B5AE',
    wash: '#FDF1EF',
    band: '#F9DCD7',
    text: '#8C1D14',
    fill: '#E0665A',
    dot: solarpunkColor.danger,
  },
  ok: {
    wash: '#EDF7EC',
    band: '#D6EED3',
    text: '#1F5E22',
    fill: '#4CAF50',
    dot: solarpunkColor.ok,
  },
  neutral: {
    band: '#EEEAE0',
    text: '#4E5A4A',
    dot: '#9AA394',
  },
} as const satisfies TonePalette;

export const cyberpunkTone = {
  claude: {
    border: '#FF7AE6',
    wash: '#1E1232',
    band: cyberpunkColor.claudeTint,
    text: cyberpunkColor.claudeText,
    dot: cyberpunkColor.claude,
  },
  ado: {
    wash: '#0A2430',
    band: cyberpunkColor.adoTint,
    text: cyberpunkColor.ado,
    fill: cyberpunkColor.skyGlow,
    dot: cyberpunkColor.ado,
  },
  attention: {
    border: '#FFC02E',
    band: '#3D2E08',
    text: '#FFE08A',
    dot: cyberpunkColor.attention,
  },
  danger: {
    border: '#FF8A9B',
    wash: '#2A0F17',
    band: '#4A1424',
    text: '#FFB3BF',
    fill: '#FF5370',
    dot: cyberpunkColor.danger,
  },
  ok: {
    wash: '#0A2A1C',
    band: '#0E3A26',
    text: '#9BFFC8',
    fill: '#39FF88',
    dot: cyberpunkColor.ok,
  },
  neutral: {
    band: '#262345',
    text: '#D6D1F0',
    dot: '#8D88B3',
  },
} as const satisfies TonePalette;

export const tone = {
  claude: varsFor('tone-claude-', keysOf(lightTone.claude)),
  ado: varsFor('tone-ado-', keysOf(lightTone.ado)),
  attention: varsFor('tone-attention-', keysOf(lightTone.attention)),
  danger: varsFor('tone-danger-', keysOf(lightTone.danger)),
  ok: varsFor('tone-ok-', keysOf(lightTone.ok)),
  neutral: varsFor('tone-neutral-', keysOf(lightTone.neutral)),
} as const;

export type Tone = keyof typeof tone;

/** Running progress: the Claude colour into the sky glow, left to right. */
export const progressGradient = {
  from: cssVar('claude'),
  to: cssVar('sky-glow'),
} as const;

/**
 * Merged and other finished cards fade back so live work stands out. AL-033: the fade is mostly a
 * loss of colour (`mutedFilter`, which keeps luminance and so contrast) with a light opacity on top;
 * the artboard's 0.75 opacity left the card's text at about 3.2:1, under design §11's 4.5:1.
 */
export const mutedOpacity = 0.95;
export const mutedFilter = 'grayscale(0.7)';
