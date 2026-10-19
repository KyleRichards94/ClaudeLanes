/**
 * Light and dark colour palettes. Components paint with `light-dark()`, so the document's
 * `color-scheme` swaps the whole app. The light values are design §11; the dark values are the
 * same cool violet and sky, set down on a blue-black ground so text still clears 4.5:1.
 */

export const lightColor = {
  bg: '#F4F7FB',
  surface: '#FFFFFF',
  ink: '#0F1B2D',
  muted: '#5B6B82',
  line: '#E2E8F0',
  claude: '#5B4BC4',
  claudeTint: '#EEEBFF',
  claudeText: '#4A3BB0',
  ado: '#0369A1',
  adoTint: '#E0F2FE',
  ok: '#059669',
  attention: '#D97706',
  danger: '#B91C1C',
  skyGlow: '#38BDF8',
  /** Label and icon on a saturated fill (primary buttons, the logo, the Live chip). */
  onAccent: '#FFFFFF',
  /** Label on the strong button, whose fill is `ink` and so flips from dark to light. */
  onInk: '#FFFFFF',
} as const;

export const darkColor = {
  bg: '#101820',
  surface: '#1A2432',
  ink: '#E7EEF6',
  muted: '#A8B7C9',
  line: '#334155',
  /** Lifted just enough to clear 3:1 on the dark ground; near-white labels still clear 4.5:1 on it. */
  claude: '#5B65C4',
  claudeTint: '#2C2654',
  claudeText: '#DDD6FE',
  ado: '#7DD3FC',
  adoTint: '#123448',
  ok: '#34D399',
  attention: '#FBBF24',
  danger: '#FCA5A5',
  skyGlow: '#38BDF8',
  onAccent: '#F7F9FC',
  onInk: '#101820',
} as const;

export type PaletteColor = keyof typeof lightColor;

/** The first colour of a `light-dark()` pair, or the value itself when it is not one. */
export function lightOf(value: string): string {
  if (!value.startsWith('light-dark(') || !value.endsWith(')')) return value;
  const inner = value.slice('light-dark('.length, -1);
  let depth = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) return inner.slice(0, index).trim();
  }
  return value;
}

/** A colour that follows the document color-scheme. */
export function lightDark(light: string, dark: string): string {
  return `light-dark(${light}, ${dark})`;
}

export function themedColors<K extends string>(light: Record<K, string>, dark: Record<K, string>): Record<K, string> {
  const themed = {} as Record<K, string>;
  for (const key of Object.keys(light) as K[]) themed[key] = lightDark(light[key], dark[key]);
  return themed;
}
