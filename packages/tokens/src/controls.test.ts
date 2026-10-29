import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from './contrast';
import { control } from './controls';
import { THEMES, themes } from './themes';

describe('control tokens', () => {
  it('keeps the press and disabled treatments beside the colours', () => {
    expect(control.pressedFilter).toBe('brightness(0.94)');
    expect(control.disabledOpacity).toBe(0.5);
  });

  describe.each(THEMES)('%s', (theme) => {
    const { color, control: palette } = themes[theme];

    it('control ink meets 4.5:1 on the surface and on the app ground', () => {
      expect(contrastRatio(palette.ink, color.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.ink, color.bg)).toBeGreaterThanOrEqual(4.5);
    });

    it('tints the primary glow with the Claude colour', () => {
      const rgb = parseHex(color.claude).join(', ');
      expect(palette.primaryShadow).toContain(`rgba(${rgb},`);
      expect(palette.primaryShadowLifted).toContain(`rgba(${rgb},`);
    });
  });
});
