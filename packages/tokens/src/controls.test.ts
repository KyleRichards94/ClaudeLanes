import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color } from './index';
import { control } from './controls';

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

describe('control tokens', () => {
  it.each(Object.entries(control))('CSS variable --al-control-%s mirrors the TS value', (key, value) => {
    expect(cssVar(`control-${kebab(key)}`)?.toLowerCase()).toBe(String(value).toLowerCase());
  });

  it('control ink meets 4.5:1 on white and on the app ground', () => {
    expect(contrast(control.ink, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(control.ink, color.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('tints the primary glow with the Claude violet', () => {
    const violet = [1, 3, 5].map((i) => parseInt(color.claude.slice(i, i + 2), 16)).join(', ');
    expect(control.primaryShadow).toContain(`rgba(${violet},`);
    expect(control.primaryShadowLifted).toContain(`rgba(${violet},`);
  });
});
