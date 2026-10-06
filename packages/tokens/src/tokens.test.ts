import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color, glass, radius } from './index';

const css = readFileSync(new URL('./agent-lanes-tokens.css', import.meta.url), 'utf8');

function cssVar(name: string): string | undefined {
  return new RegExp(`--al-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('CSS variables mirror the TypeScript tokens', () => {
  it.each(Object.entries(color))('colour %s', (key, value) => {
    expect(cssVar(kebab(key))?.toLowerCase()).toBe(value.toLowerCase());
  });

  it.each(Object.entries(radius))('radius %s', (key, value) => {
    expect(cssVar(`radius-${key}`)).toBe(`${value}px`);
  });

  it('blur levels', () => {
    expect(cssVar('blur-sm')).toBe(`${glass.blurSm}px`);
    expect(cssVar('blur-md')).toBe(`${glass.blurMd}px`);
    expect(cssVar('blur-xl')).toBe(`${glass.blurXl}px`);
  });
});
