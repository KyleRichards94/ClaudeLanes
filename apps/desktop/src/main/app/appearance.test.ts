import { cyberpunkColor, darkColor, lightColor, solarpunkColor } from '@agent-lanes/tokens';
import { describe, expect, it } from 'vitest';
import { nativeThemeSource, resolvedTheme, windowBackground } from './appearance';

describe('appearance', () => {
  it('passes System through and maps every theme to its light or dark base', () => {
    expect(nativeThemeSource('system')).toBe('system');
    expect(nativeThemeSource('light')).toBe('light');
    expect(nativeThemeSource('dark')).toBe('dark');
    expect(nativeThemeSource('solarpunk')).toBe('light');
    expect(nativeThemeSource('cyberpunk')).toBe('dark');
  });

  it('resolves System by what the computer prefers and leaves a picked theme alone', () => {
    expect(resolvedTheme('system', true)).toBe('dark');
    expect(resolvedTheme('system', false)).toBe('light');
    expect(resolvedTheme('solarpunk', true)).toBe('solarpunk');
    expect(resolvedTheme('dark', false)).toBe('dark');
  });

  it('paints the window in the resolved theme ground', () => {
    expect(windowBackground('system', true)).toBe(darkColor.bg);
    expect(windowBackground('system', false)).toBe(lightColor.bg);
    expect(windowBackground('solarpunk', true)).toBe(solarpunkColor.bg);
    expect(windowBackground('cyberpunk', false)).toBe(cyberpunkColor.bg);
  });
});
