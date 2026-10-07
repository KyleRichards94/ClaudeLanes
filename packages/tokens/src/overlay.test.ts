import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color, glass } from './index';
import { overlay } from './overlay';

const css = readFileSync(new URL('./agent-lanes-tokens.css', import.meta.url), 'utf8');

function cssVar(name: string): string | undefined {
  return new RegExp(`--al-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

describe('overlay tokens', () => {
  it('CSS variables mirror the TS values', () => {
    expect(cssVar('overlay-scrim')).toBe(overlay.scrim);
    expect(cssVar('overlay-scrim-blur')).toBe(`${overlay.scrimBlur}px`);
    expect(cssVar('overlay-shadow')).toBe(overlay.shadow);
  });

  it('blurs the app behind a modal with the small glass step, less than the modal glass itself', () => {
    expect(overlay.scrimBlur).toBe(glass.blurSm);
    expect(overlay.scrimBlur).toBeLessThan(glass.blurXl);
  });

  it('keeps the scrim a pale, see-through wash rather than a dark dim', () => {
    const [r = 0, g = 0, b = 0, alpha = 1] = /rgba\(([^)]+)\)/
      .exec(overlay.scrim)?.[1]
      ?.split(',')
      .map(Number) ?? [];
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(220);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('casts the shadow in the ink colour, offset downwards', () => {
    expect(overlay.shadow).toContain(`rgba(${rgbOf(color.ink)},`);
    expect(overlay.shadow).toMatch(/^0 \d+px /);
  });
});
