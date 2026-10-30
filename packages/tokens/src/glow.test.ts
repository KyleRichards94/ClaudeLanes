import { describe, expect, it } from 'vitest';
import { edgeGlow, glow, ring, textGlow } from './glow';
import { THEMES, themes } from './themes';

describe('glow', () => {
  it('only cyberpunk glows', () => {
    for (const theme of THEMES) expect(themes[theme].glow.level, theme).toBe(theme === 'cyberpunk' ? '1' : '0');
  });

  // At level 0 every layer is a 0 px, fully transparent shadow, so the other themes draw nothing.
  it.each([
    ['glow', glow('#FF2BD6', 0.8)],
    ['edgeGlow', edgeGlow('#FF2BD6')],
    ['edgeGlow top', edgeGlow('#FF2BD6', 'top')],
    ['ring', ring('#FF2BD6')],
    ['textGlow', textGlow('#FF2BD6', 0.6)],
  ])('%s scales every length and alpha by the glow level', (_name, value) => {
    const unscaled = value.replace(/calc\([^()]*\* var\(--al-glow-level\)\)/g, '');
    expect(unscaled).not.toMatch(/px|%/);
  });
});
