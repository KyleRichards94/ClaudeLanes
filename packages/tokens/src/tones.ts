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
 *
 * Values that repeat a `color` token are spelled out rather than imported, because index.ts
 * re-exports this file (an import back would be circular); tones.test.ts checks they still match.
 * Keep the light hex in sync with the tone block in agent-lanes-tokens.css.
 */

import { darkColor, lightColor, lightDark } from './palette';

const pair = lightDark;

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
} as const;

function themedTone<T extends Record<string, string>>(light: T, dark: { [K in keyof T]: string }): { [K in keyof T]: string } {
  const themed = {} as { [K in keyof T]: string };
  for (const key of Object.keys(light) as (keyof T)[]) themed[key] = pair(String(light[key]), String(dark[key]));
  return themed;
}

export const tone = {
  claude: themedTone(lightTone.claude, darkTone.claude),
  ado: themedTone(lightTone.ado, darkTone.ado),
  attention: themedTone(lightTone.attention, darkTone.attention),
  danger: themedTone(lightTone.danger, darkTone.danger),
  ok: themedTone(lightTone.ok, darkTone.ok),
  neutral: themedTone(lightTone.neutral, darkTone.neutral),
} as const;

export type Tone = keyof typeof tone;

/** Running progress: Claude violet into the sky glow, left to right. */
export const progressGradient = {
  from: pair(lightColor.claude, darkColor.claude),
  to: pair(lightColor.skyGlow, darkColor.skyGlow),
} as const;

/**
 * Merged and other finished cards fade back so live work stands out. AL-033: the fade is mostly a
 * loss of colour (`mutedFilter`, which keeps luminance and so contrast) with a light opacity on top;
 * the artboard's 0.75 opacity left the card's text at about 3.2:1, under design §11's 4.5:1.
 */
export const mutedOpacity = 0.95;
export const mutedFilter = 'grayscale(0.7)';
