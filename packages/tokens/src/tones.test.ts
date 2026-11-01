import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { color } from './index';
import { THEMES, themes } from './themes';
import { mutedFilter, mutedOpacity, progressGradient, tone } from './tones';

describe('tone tints', () => {
  it('runs progress from the Claude colour into the sky glow', () => {
    expect(progressGradient).toEqual({ from: color.claude, to: color.skyGlow });
  });

  it('fades merged cards mostly by colour, a little by opacity', () => {
    expect(mutedOpacity).toBe(0.95);
    expect(mutedFilter).toBe('grayscale(0.7)');
  });

  it.each(Object.entries(tone))('%s has a band, text and dot for pills', (_name, values) => {
    expect(values).toEqual(expect.objectContaining({ band: expect.any(String), text: expect.any(String), dot: expect.any(String) }));
  });

  describe.each(THEMES)('%s', (theme) => {
    const { color: palette, tone: tones } = themes[theme];

    it('repeats the colour tokens it shares with the palette exactly', () => {
      expect(tones.claude.band).toBe(palette.claudeTint);
      expect(tones.claude.text).toBe(palette.claudeText);
      expect(tones.claude.dot).toBe(palette.claude);
      expect(tones.ado.band).toBe(palette.adoTint);
      expect(tones.ado.text).toBe(palette.ado);
      expect(tones.ado.fill).toBe(palette.skyGlow);
      expect(tones.ado.dot).toBe(palette.ado);
      expect(tones.attention.dot).toBe(palette.attention);
      expect(tones.danger.dot).toBe(palette.danger);
      expect(tones.ok.dot).toBe(palette.ok);
    });

    it.each(Object.entries(tones))('%s text meets 4.5:1 on its band', (_name, values) => {
      expect(contrastRatio(values.text, values.band)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
