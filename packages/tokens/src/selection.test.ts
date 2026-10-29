import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { darkColor, lightColor } from './index';
import { darkSelection, lightSelection, selection } from './selection';

const css = readFileSync(new URL('./agent-lanes-tokens.css', import.meta.url), 'utf8');

function cssVar(name: string): string | undefined {
  return new RegExp(`--al-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** WCAG 2 relative luminance contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('selection control tokens', () => {
  it.each(Object.entries(lightSelection))('CSS variable --al-selection-%s mirrors the light value', (key, value) => {
    expect(cssVar(`selection-${kebab(key)}`)?.toLowerCase()).toBe(String(value).toLowerCase());
  });

  it('keeps the disabled opacity beside the colours', () => {
    expect(cssVar('selection-disabled-opacity')).toBe(String(selection.disabledOpacity));
  });

  it('keeps every label legible at 4.5:1 on the surface it sits on', () => {
    // Unselected segments on the grey track; side text and effort pills on white.
    expect(contrast(lightSelection.label, lightSelection.track)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightSelection.label, lightColor.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkSelection.label, darkSelection.track)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkSelection.label, darkColor.surface)).toBeGreaterThanOrEqual(4.5);
    // Selected segment: violet or ink on the thumb; selected pill: onAccent on violet.
    expect(contrast(lightColor.claudeText, lightSelection.thumb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightColor.ink, lightSelection.thumb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor.claudeText, darkSelection.thumb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor.ink, darkSelection.thumb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightColor.onAccent, lightColor.claude)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor.onAccent, darkColor.claude)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor.ink, darkColor.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows the switch on state at 3:1 against the row', () => {
    expect(contrast(lightColor.claude, lightColor.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkColor.claude, darkColor.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkColor.claude, darkColor.bg)).toBeGreaterThanOrEqual(3);
  });
});
