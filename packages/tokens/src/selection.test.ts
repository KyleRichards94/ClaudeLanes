import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { selection } from './selection';
import { THEMES, themes } from './themes';

describe('selection control tokens', () => {
  it('keeps the disabled opacity beside the colours', () => {
    expect(selection.disabledOpacity).toBe(0.5);
  });

  describe.each(THEMES)('%s', (theme) => {
    const { color, selection: palette } = themes[theme];

    it('keeps every label legible at 4.5:1 on the surface it sits on', () => {
      // Unselected segments on the track; side text and effort pills on the surface.
      expect(contrastRatio(palette.label, palette.track)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.label, color.surface)).toBeGreaterThanOrEqual(4.5);
      // Selected segment: claude text or ink on the thumb; selected pill: onAccent on claude.
      expect(contrastRatio(color.claudeText, palette.thumb)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.ink, palette.thumb)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.onAccent, color.claude)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.ink, color.surface)).toBeGreaterThanOrEqual(4.5);
    });

    it('shows the switch on state at 3:1 against the row', () => {
      expect(contrastRatio(color.claude, color.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(color.claude, color.bg)).toBeGreaterThanOrEqual(3);
    });
  });
});
