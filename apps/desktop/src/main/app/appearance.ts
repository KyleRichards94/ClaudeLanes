import type { Appearance } from '@agent-lanes/contracts';
import { themes, type Theme, type ThemeBase } from '@agent-lanes/tokens';

/** What `nativeTheme.themeSource` gets: System as is, otherwise the theme's base. */
export function nativeThemeSource(appearance: Appearance): 'system' | ThemeBase {
  return appearance === 'system' ? 'system' : themes[appearance].base;
}

/** The theme on screen: System becomes light or dark by what the computer prefers. */
export function resolvedTheme(appearance: Appearance, systemDark: boolean): Theme {
  if (appearance === 'system') return systemDark ? 'dark' : 'light';
  return appearance;
}

/** The window's own background: shown before the renderer paints and behind it afterwards. */
export function windowBackground(appearance: Appearance, systemDark: boolean): string {
  return themes[resolvedTheme(appearance, systemDark)].color.bg;
}
