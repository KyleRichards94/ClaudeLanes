/**
 * Hex palettes, one per theme. Components never paint with these: they use the `var(--al-*)`
 * references in index.ts, and the theme's block in agent-lanes-tokens.css carries the hex.
 * The palettes stay here for the window frame, the contrast tests and the tokens gallery sheet.
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
  /** Label on the strong button, whose fill is `ink`. */
  onInk: '#FFFFFF',
} as const;

export type PaletteColor = keyof typeof lightColor;
export type ColorPalette = Record<PaletteColor, string>;

export const darkColor = {
  bg: '#101820',
  surface: '#1A2432',
  ink: '#E7EEF6',
  muted: '#A8B7C9',
  line: '#334155',
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
} as const satisfies ColorPalette;

/** Solarpunk (AL-286): cream ground, teal-green for Claude, sea blue for ADO, sun gold for the glow. */
export const solarpunkColor = {
  bg: '#F7F3E8',
  surface: '#FFFDF7',
  ink: '#1F2A1E',
  muted: '#5C6B57',
  line: '#E3DCC8',
  claude: '#0F766E',
  claudeTint: '#D9F2EC',
  claudeText: '#0B5A54',
  ado: '#1A669A',
  adoTint: '#DCEEF9',
  ok: '#2E7D32',
  attention: '#B45309',
  danger: '#B3261E',
  skyGlow: '#F5B82E',
  onAccent: '#FFFFFF',
  onInk: '#FFFFFF',
} as const satisfies ColorPalette;

/** Cyberpunk: near-black ground, neon magenta for Claude, cyan for ADO; dark text on the neon fills. */
export const cyberpunkColor = {
  bg: '#0A0817',
  surface: '#1E1A42',
  ink: '#E6F7FF',
  muted: '#9DA9CF',
  line: '#34306A',
  claude: '#FF2BD6',
  claudeTint: '#3D0F48',
  claudeText: '#FF9BEA',
  ado: '#00F0FF',
  adoTint: '#062F3B',
  ok: '#00FF9F',
  attention: '#FCEE0A',
  danger: '#FF3366',
  skyGlow: '#00F0FF',
  onAccent: '#05050A',
  onInk: '#05050A',
} as const satisfies ColorPalette;

export const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function keysOf<T extends object>(value: T): (keyof T & string)[] {
  return Object.keys(value) as (keyof T & string)[];
}

export function cssVar(name: string): string {
  return `var(--al-${name})`;
}

/** `var(--al-<prefix><kebab key>)` for every key: `varsFor('tone-ok-', ['band'])` → `{ band: 'var(--al-tone-ok-band)' }`. */
export function varsFor<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> {
  const vars = {} as Record<K, string>;
  for (const key of keys) vars[key] = cssVar(`${prefix}${kebab(key)}`);
  return vars;
}
