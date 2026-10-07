import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color } from './index';
import { selection } from './selection';

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
  it.each(Object.entries(selection))('CSS variable --al-selection-%s mirrors the TS value', (key, value) => {
    expect(cssVar(`selection-${kebab(key)}`)?.toLowerCase()).toBe(String(value).toLowerCase());
  });

  it('keeps every label legible at 4.5:1 on the surface it sits on', () => {
    // Unselected segments on the grey track; side text and effort pills on white.
    expect(contrast(selection.label, selection.track)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(selection.label, color.surface)).toBeGreaterThanOrEqual(4.5);
    // Selected segment: violet or ink on the white thumb; selected pill: white on violet.
    expect(contrast(color.claudeText, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.surface, color.claude)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows the switch on state at 3:1 against the white row', () => {
    expect(contrast(color.claude, color.surface)).toBeGreaterThanOrEqual(3);
  });
});
