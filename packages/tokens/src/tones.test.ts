import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color } from './index';
import { mutedFilter, mutedOpacity, progressGradient, tone } from './tones';

const css = readFileSync(new URL('./agent-lanes-tokens.css', import.meta.url), 'utf8');

function cssVar(name: string): string | undefined {
  return new RegExp(`--al-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

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

const entries = Object.entries(tone).flatMap(([name, values]) =>
  Object.entries(values).map(([key, value]) => [`${name}-${key}`, value] as const),
);

describe('tone tints', () => {
  it.each(entries)('CSS variable --al-tone-%s mirrors the TS value', (name, value) => {
    expect(cssVar(`tone-${name}`)?.toLowerCase()).toBe(value.toLowerCase());
  });

  it('repeats the colour tokens it shares with `color` exactly', () => {
    expect(tone.claude.band).toBe(color.claudeTint);
    expect(tone.claude.text).toBe(color.claudeText);
    expect(tone.ado.band).toBe(color.adoTint);
    expect(tone.ado.text).toBe(color.ado);
    expect(tone.ado.fill).toBe(color.skyGlow);
    expect(progressGradient).toEqual({ from: color.claude, to: color.skyGlow });
    expect(tone.claude.dot).toBe(color.claude);
    expect(tone.ado.dot).toBe(color.ado);
    expect(tone.attention.dot).toBe(color.attention);
    expect(tone.danger.dot).toBe(color.danger);
    expect(tone.ok.dot).toBe(color.ok);
  });

  it.each(Object.entries(tone))('%s has a band, text and dot for pills', (_name, values) => {
    expect(values).toEqual(
      expect.objectContaining({ band: expect.any(String), text: expect.any(String), dot: expect.any(String) }),
    );
  });

  it.each(Object.entries(tone))('%s text meets 4.5:1 on its band', (_name, values) => {
    expect(contrast(values.text, values.band)).toBeGreaterThanOrEqual(4.5);
  });

  it('mirrors the progress gradient and muted opacity in CSS', () => {
    expect(cssVar('progress-gradient')?.toLowerCase()).toBe(
      `linear-gradient(90deg, ${progressGradient.from}, ${progressGradient.to})`.toLowerCase(),
    );
    expect(cssVar('muted-opacity')).toBe(String(mutedOpacity));
    expect(cssVar('muted-filter')).toBe(mutedFilter);
  });
});
