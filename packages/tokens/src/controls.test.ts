import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { darkColor, darkControl, lightColor, lightControl } from './index';
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
  it.each(Object.entries(lightControl))('CSS variable --al-control-%s mirrors the light value', (key, value) => {
    expect(cssVar(`control-${kebab(key)}`)?.toLowerCase()).toBe(String(value).toLowerCase());
  });

  it('keeps the press and disabled treatments beside the colours', () => {
    expect(cssVar('control-pressed-filter')).toBe(control.pressedFilter);
    expect(cssVar('control-disabled-opacity')).toBe(String(control.disabledOpacity));
  });

  it('control ink meets 4.5:1 on the surface and on the app ground', () => {
    expect(contrast(lightControl.ink, lightColor.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightControl.ink, lightColor.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkControl.ink, darkColor.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkControl.ink, darkColor.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('tints the primary glow with the Claude violet', () => {
    const violet = [1, 3, 5].map((i) => parseInt(lightColor.claude.slice(i, i + 2), 16)).join(', ');
    expect(lightControl.primaryShadow).toContain(`rgba(${violet},`);
    expect(lightControl.primaryShadowLifted).toContain(`rgba(${violet},`);
  });
});
