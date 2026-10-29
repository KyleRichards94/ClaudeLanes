import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssThemeVariables } from './css-theme-variables';
import { color, glass, radius, shadow, tone } from './index';
import { THEMES, resolveToken, themeVariables, themes } from './themes';

const css = readFileSync(new URL('./agent-lanes-tokens.css', import.meta.url), 'utf8');
const cssThemes = cssThemeVariables(css);

/** Defined in CSS only: the ground animation and the atmosphere blooms (global.css reads them). */
const CSS_ONLY = ['ground-from', 'ground-to', 'atmosphere-1', 'atmosphere-2', 'atmosphere-3'];

const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

describe('themes', () => {
  it.each(THEMES)('%s: the CSS block mirrors the TypeScript palette', (theme) => {
    const block = cssThemes[theme] ?? {};
    for (const [name, value] of Object.entries(themeVariables(theme))) {
      expect(block[name], `--al-${name}`).toBeDefined();
      expect(normalise(block[name] ?? ''), `--al-${name}`).toBe(normalise(value));
    }
    for (const name of CSS_ONLY) expect(block[name], `--al-${name}`).toBeDefined();
  });

  it.each(THEMES.filter((theme) => theme !== 'light'))('%s: the block defines exactly the themed variables, nothing static', (theme) => {
    const expected = [...Object.keys(themeVariables(theme)), ...CSS_ONLY].sort();
    expect(Object.keys(cssThemes[theme] ?? {}).sort()).toEqual(expected);
  });

  it.each(THEMES)('%s names a light or dark base', (theme) => {
    expect(['light', 'dark']).toContain(themes[theme].base);
  });

  it('resolves a token to its value in a theme', () => {
    expect(resolveToken('var(--al-claude)', 'light')).toBe('#5B4BC4');
    expect(resolveToken('var(--al-claude)', 'solarpunk')).toBe('#0F766E');
    expect(resolveToken('var(--al-tone-ok-band)', 'dark')).toBe('#134535');
    expect(resolveToken('#123456', 'dark')).toBe('#123456');
  });

  it('keeps the static values in CSS', () => {
    const root = cssThemes['light'] ?? {};
    for (const [key, value] of Object.entries(radius)) expect(root[`radius-${key}`]).toBe(`${value}px`);
    expect(root['blur-sm']).toBe(`${glass.blurSm}px`);
    expect(root['blur-md']).toBe(`${glass.blurMd}px`);
    expect(root['blur-xl']).toBe(`${glass.blurXl}px`);
    expect(root['muted-opacity']).toBe('0.95');
    expect(root['muted-filter']).toBe('grayscale(0.7)');
    expect(root['selection-disabled-opacity']).toBe('0.5');
    expect(root['control-pressed-filter']).toBe('brightness(0.94)');
    expect(root['control-disabled-opacity']).toBe('0.5');
    expect(root['overlay-scrim-blur']).toBe('8px');
  });

  it('paintable tokens are var() references to themed variables', () => {
    const names = Object.keys(themeVariables('light'));
    const refs = [...Object.values(color), glass.fillMin, glass.fillMax, glass.highlight, glass.border, shadow.card, shadow.lifted, ...Object.values(tone).flatMap((values) => Object.values(values))];
    for (const ref of refs) {
      const name = /^var\(--al-([a-z0-9-]+)\)$/.exec(ref)?.[1];
      expect(name, ref).toBeDefined();
      expect(names, ref).toContain(name);
    }
  });
});
