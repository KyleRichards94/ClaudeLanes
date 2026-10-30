import { cyberpunkControl, darkControl, lightControl, solarpunkControl, type ControlPalette } from './controls';
import { cyberpunkOverlay, darkOverlay, lightOverlay, solarpunkOverlay, type OverlayPalette } from './overlay';
import { cyberpunkGlow, darkGlow, lightGlow, solarpunkGlow, type GlowPalette } from './glow';
import { cyberpunkColor, darkColor, kebab, lightColor, solarpunkColor, type ColorPalette } from './palette';
import { cyberpunkSelection, darkSelection, lightSelection, solarpunkSelection, type SelectionPalette } from './selection';
import {
  cyberpunkGlass,
  cyberpunkShadow,
  darkGlass,
  darkShadow,
  lightGlass,
  lightShadow,
  solarpunkGlass,
  solarpunkShadow,
  type GlassPalette,
  type ShadowPalette,
} from './surfaces';
import { cyberpunkTone, darkTone, lightTone, solarpunkTone, type TonePalette } from './tones';

/** Mirrors `THEMES` in @agent-lanes/contracts (the setting); `themes[appearance]` fails the typecheck where they drift. */
export const THEMES = ['light', 'dark', 'solarpunk', 'cyberpunk'] as const;
export type Theme = (typeof THEMES)[number];

/** What the window frame and native controls follow. */
export type ThemeBase = 'light' | 'dark';

export interface ThemePalette {
  base: ThemeBase;
  color: ColorPalette;
  tone: TonePalette;
  glass: GlassPalette;
  shadow: ShadowPalette;
  selection: SelectionPalette;
  control: ControlPalette;
  overlay: OverlayPalette;
  glow: GlowPalette;
}

export const themes: Record<Theme, ThemePalette> = {
  light: { base: 'light', color: lightColor, tone: lightTone, glass: lightGlass, shadow: lightShadow, selection: lightSelection, control: lightControl, overlay: lightOverlay, glow: lightGlow },
  dark: { base: 'dark', color: darkColor, tone: darkTone, glass: darkGlass, shadow: darkShadow, selection: darkSelection, control: darkControl, overlay: darkOverlay, glow: darkGlow },
  solarpunk: {
    base: 'light',
    color: solarpunkColor,
    tone: solarpunkTone,
    glass: solarpunkGlass,
    shadow: solarpunkShadow,
    selection: solarpunkSelection,
    control: solarpunkControl,
    overlay: solarpunkOverlay,
    glow: solarpunkGlow,
  },
  cyberpunk: {
    base: 'dark',
    color: cyberpunkColor,
    tone: cyberpunkTone,
    glass: cyberpunkGlass,
    shadow: cyberpunkShadow,
    selection: cyberpunkSelection,
    control: cyberpunkControl,
    overlay: cyberpunkOverlay,
    glow: cyberpunkGlow,
  },
};

/** Every themed `--al-*` variable (name without the prefix) and its value in `theme`: what the theme's block in agent-lanes-tokens.css defines. */
export function themeVariables(theme: Theme): Record<string, string> {
  const palette = themes[theme];
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette.color)) vars[kebab(key)] = value;
  vars['progress-gradient'] = `linear-gradient(90deg, ${palette.color.claude}, ${palette.color.skyGlow})`;
  for (const [key, value] of Object.entries(palette.glass)) vars[`glass-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(palette.shadow)) vars[`shadow-${key}`] = value;
  for (const [name, values] of Object.entries(palette.tone)) {
    for (const [key, value] of Object.entries(values)) vars[`tone-${name}-${key}`] = value;
  }
  for (const [key, value] of Object.entries(palette.selection)) vars[`selection-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(palette.control)) vars[`control-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(palette.overlay)) vars[`overlay-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(palette.glow)) vars[`glow-${kebab(key)}`] = value;
  return vars;
}

/** The hex or rgba behind a `var(--al-*)` token in `theme`; anything else comes back as is. */
export function resolveToken(value: string, theme: Theme): string {
  const name = /^var\(--al-([a-z0-9-]+)\)$/.exec(value)?.[1];
  return (name && themeVariables(theme)[name]) || value;
}
