import { describe, expect, it } from 'vitest';
import { parseHex } from './contrast';
import { glass } from './index';
import { overlay } from './overlay';
import { THEMES, themes } from './themes';

describe('overlay tokens', () => {
  it('blurs the app behind a modal with the small glass step, less than the modal glass itself', () => {
    expect(overlay.scrimBlur).toBe(glass.blurSm);
    expect(overlay.scrimBlur).toBeLessThan(glass.blurXl);
  });

  it('casts the light shadow in the ink colour', () => {
    expect(themes.light.overlay.shadow).toContain(`rgba(${parseHex(themes.light.color.ink).join(', ')},`);
  });

  describe.each(THEMES)('%s', (theme) => {
    const { base, overlay: palette } = themes[theme];

    it('keeps the scrim see-through: pale on a light theme, dim on a dark one', () => {
      const [r = 0, g = 0, b = 0, alpha = 1] = /rgba\(([^)]+)\)/.exec(palette.scrim)?.[1]?.split(',').map(Number) ?? [];
      if (base === 'light') expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(220);
      else expect(Math.max(r, g, b)).toBeLessThanOrEqual(40);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    });

    it('casts a large soft shadow, offset downwards', () => {
      expect(palette.shadow).toMatch(/^0 24px 72px rgba\(/);
    });
  });
});
