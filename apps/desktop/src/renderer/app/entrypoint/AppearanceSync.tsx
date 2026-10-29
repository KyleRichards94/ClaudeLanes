import { useEffect } from 'react';
import { themes } from '@agent-lanes/tokens';
import { useAppearance, useResolvedTheme } from '@/shared/model';

/**
 * `data-theme` picks the theme's variable block in agent-lanes-tokens.css; `color-scheme` tells
 * Chromium whether native controls and scrollbars are light or dark (both, for System).
 */
export function AppearanceSync() {
  const appearance = useAppearance();
  const theme = useResolvedTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = appearance === 'system' ? 'light dark' : themes[theme].base;
  }, [appearance, theme]);

  return null;
}
