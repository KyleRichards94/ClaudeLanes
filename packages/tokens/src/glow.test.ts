import { describe, expect, it } from 'vitest';
import { edgeGlow, glow, ring, textGlow } from './glow';
import { themes } from './themes';

describe('glow', () => {
  it('only cyberpunk glows', () => {
    for (const theme of ['light', 'dark', 'solarpunk'] as const) expect(themes[theme].glow, theme).toEqual({ level: '0', reach: '0', text: '0' });
  });

  // With the theme's values at 0 every layer is a 0 px, fully transparent shadow, so nothing is drawn.
  it.each([
    ['glow', glow('#FF2BD6', 0.8)],
    ['edgeGlow', edgeGlow('#FF2BD6')],
    ['edgeGlow top', edgeGlow('#FF2BD6', 'top')],
    ['ring', ring('#FF2BD6')],
    ['textGlow', textGlow('#FF2BD6', 0.6)],
  ])('%s scales every length and alpha by the theme glow', (_name, value) => {
    const unscaled = value.replace(/min\(1px, /g, '(').replace(/calc\([^()]*\* var\(--al-glow-(level|reach|text)\)\)/g, '');
    expect(unscaled).not.toMatch(/px|%/);
  });
});
