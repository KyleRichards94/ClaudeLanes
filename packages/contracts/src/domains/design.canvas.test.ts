import { describe, expect, it } from 'vitest';
import { DesignCanvasRefSchema, parseDesignCanvasUrl } from './design.canvas';

describe('parseDesignCanvasUrl', () => {
  it('reads a standalone Claude Design project link', () => {
    expect(parseDesignCanvasUrl('https://claude.ai/design/p/019a2b3c-4d5e-7f80-9a1b-2c3d4e5f6a7b')).toEqual({
      kind: 'design-project',
      id: '019a2b3c-4d5e-7f80-9a1b-2c3d4e5f6a7b',
      url: 'https://claude.ai/design/p/019a2b3c-4d5e-7f80-9a1b-2c3d4e5f6a7b',
    });
  });

  it('reads both artifact link forms', () => {
    expect(parseDesignCanvasUrl('https://claude.ai/artifact/aBc123_x')).toEqual({
      kind: 'artifact',
      id: 'aBc123_x',
      url: 'https://claude.ai/artifact/aBc123_x',
    });
    expect(parseDesignCanvasUrl('https://claude.ai/code/artifact/e1281a59-d522-4338-a90d-cc85d9d80ed9')).toEqual({
      kind: 'artifact',
      id: 'e1281a59-d522-4338-a90d-cc85d9d80ed9',
      url: 'https://claude.ai/code/artifact/e1281a59-d522-4338-a90d-cc85d9d80ed9',
    });
  });

  it('accepts what people paste: whitespace, no scheme, upper-case host, trailing slash, query or fragment', () => {
    const expected = { kind: 'design-project', id: 'p-42', url: 'https://claude.ai/design/p/p-42' };
    expect(parseDesignCanvasUrl('  https://claude.ai/design/p/p-42/  ')).toEqual(expected);
    expect(parseDesignCanvasUrl('claude.ai/design/p/p-42')).toEqual(expected);
    expect(parseDesignCanvasUrl('https://Claude.AI/design/p/p-42')).toEqual(expected);
    expect(parseDesignCanvasUrl('https://claude.ai/design/p/p-42?file=JobControl.html#zoom=2')).toEqual(expected);
  });

  it('refuses links that are not canvases', () => {
    for (const input of [
      '',
      'https://claude.ai/chat/0b1c2d3e',
      'https://claude.ai/project/0b1c2d3e',
      'https://claude.ai/design',
      'https://claude.ai/design/p/',
      'https://claude.ai/design/p/abc/files/x.html',
      'http://claude.ai/design/p/abc',
      'https://claude.ai.evil.example/design/p/abc',
      'https://evil.example/claude.ai/design/p/abc',
      'https://user@claude.ai/design/p/abc',
      'https://claude.ai/design/p/..',
      'https://claude.ai/design/p/.hidden',
      'https://claude.ai/design/p/a%2F..',
      `https://claude.ai/design/p/${'a'.repeat(129)}`,
    ]) {
      expect(parseDesignCanvasUrl(input), input).toBeUndefined();
    }
  });

  it('produces refs that pass the schema', () => {
    for (const input of ['https://claude.ai/design/p/abc', 'https://claude.ai/artifact/xyz']) {
      expect(DesignCanvasRefSchema.safeParse(parseDesignCanvasUrl(input)).success).toBe(true);
    }
  });

  it('rejects a stored ref whose url does not match its kind', () => {
    expect(
      DesignCanvasRefSchema.safeParse({ kind: 'design-project', id: 'abc', url: 'https://claude.ai/artifact/abc' }).success,
    ).toBe(false);
  });
});
