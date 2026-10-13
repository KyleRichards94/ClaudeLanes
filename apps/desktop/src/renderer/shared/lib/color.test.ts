import { describe, expect, it } from 'vitest';
import { mix, shade } from './color';

describe('mix', () => {
  it('blends two colours', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#5B4BC4', '#FFFFFF', 0)).toBe('#5B4BC4');
    expect(mix('#5B4BC4', '#FFFFFF', 1)).toBe('#FFFFFF');
  });

  it('clamps t and accepts short hex', () => {
    expect(mix('#fff', '#000', 2)).toBe('#000000');
    expect(mix('#fff', '#000', -1)).toBe('#FFFFFF');
  });

  it('rejects a colour that is not hex', () => {
    expect(() => mix('red', '#000', 0.5)).toThrow();
  });
});

describe('shade', () => {
  it('lightens towards white and darkens towards black', () => {
    expect(shade('#5B4BC4', 0.55)).toBe(mix('#5B4BC4', '#FFFFFF', 0.55));
    expect(shade('#5B4BC4', -0.2)).toBe(mix('#5B4BC4', '#000000', 0.2));
    expect(shade('#808080', 0)).toBe('#808080');
  });

  it('keeps the Code City face order: top lightest, right face darkest', () => {
    const c = '#0369A1';
    const sum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(sum(shade(c, 0.55))).toBeGreaterThan(sum(shade(c, 0.15)));
    expect(sum(shade(c, 0.15))).toBeGreaterThan(sum(shade(c, -0.2)));
  });
});
