import { cssVar } from './palette';

/**
 * How a theme glows. `level` scales the light's strength, `reach` how far it spreads, `text` the halo behind letters.
 * All 0 draws nothing (light, dark, solarpunk); cyberpunk is tight bright neon.
 */
export const lightGlow = { level: '0', reach: '0', text: '0' } as const;

export type GlowPalette = Record<keyof typeof lightGlow, string>;

export const darkGlow: GlowPalette = { level: '0', reach: '0', text: '0' };
export const solarpunkGlow: GlowPalette = { level: '0', reach: '0', text: '0' };
export const cyberpunkGlow: GlowPalette = { level: '1', reach: '1', text: '1' };

const level = cssVar('glow-level');
const reach = cssVar('glow-reach');
const text = cssVar('glow-text');
const px = (value: number, scale = reach) => `calc(${value}px * ${scale})`;
const fade = (colour: string, percent: number, scale = level) => `color-mix(in srgb, ${colour} calc(${Math.min(100, percent)}% * ${scale}), transparent)`;

/** A neon tube's halo around a box in its own colour, like the cs-qa tracker's three strokes. A box-shadow value. */
export function glow(colour: string, strength = 1): string {
  return [
    `0 0 ${px(3 * strength)} ${fade(colour, 100 * strength)}`,
    `0 0 ${px(10 * strength)} ${fade(colour, 55 * strength)}`,
    `0 0 ${px(22 * strength)} ${fade(colour, 30 * strength)}`,
  ].join(', ');
}

/** A lit band along one edge: a bright line there and light thrown inward and out. A box-shadow value. */
export function edgeGlow(colour: string, side: 'left' | 'top' = 'left', strength = 1): string {
  if (side === 'top') {
    return [`inset 0 ${px(1)} 0 ${fade(colour, 90 * strength)}`, `inset 0 ${px(14 * strength)} ${px(16 * strength)} ${px(-12 * strength)} ${fade(colour, 45 * strength)}`].join(', ');
  }
  return [
    `inset ${px(12 * strength)} 0 ${px(16 * strength)} ${px(-10 * strength)} ${fade(colour, 60 * strength)}`,
    `${px(-3 * strength)} 0 ${px(14 * strength)} ${px(-2 * strength)} ${fade(colour, 60 * strength)}`,
  ].join(', ');
}

/** A hairline just inside a chip's edge with a little light around it. A box-shadow value. */
export function ring(colour: string, strength = 1): string {
  return [`inset 0 0 0 min(1px, ${px(1)}) ${fade(colour, 70 * strength)}`, `0 0 ${px(8 * strength)} ${fade(colour, 35 * strength)}`].join(', ');
}

/** Letters lit from behind. A text-shadow value. */
export function textGlow(colour: string, strength = 1): string {
  return [`0 0 ${px(5 * strength, text)} ${fade(colour, 65 * strength, text)}`, `0 0 ${px(14 * strength, text)} ${fade(colour, 35 * strength, text)}`].join(', ');
}
