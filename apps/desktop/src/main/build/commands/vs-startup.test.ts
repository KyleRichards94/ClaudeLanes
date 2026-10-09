import { describe, expect, it } from 'vitest';
import { startupProjectIdFromSuo } from './vs-startup';

const GUID = '261b7377-6253-4d64-81fa-d66f887e663c';
const key = Buffer.from('StartupProject=', 'utf16le');

describe('startupProjectIdFromSuo', () => {
  it('reads the GUID after StartupProject= as Visual Studio writes it', () => {
    const bytes = Buffer.concat([Buffer.alloc(40, 1), key, Buffer.from([8, 0, 0x26, 0, 0, 0]), Buffer.from(`{${GUID}};@`, 'utf16le')]);
    expect(startupProjectIdFromSuo(bytes)).toBe(GUID.toUpperCase());
  });

  it('still finds a GUID one byte off the key’s alignment', () => {
    const bytes = Buffer.concat([key, Buffer.from([0x26, 0, 0]), Buffer.from(`{${GUID}}`, 'utf16le')]);
    expect(startupProjectIdFromSuo(bytes)).toBe(GUID.toUpperCase());
  });

  it('gives null without the key or without a GUID near it', () => {
    expect(startupProjectIdFromSuo(Buffer.from(`ActiveCfg={${GUID}}`, 'utf16le'))).toBeNull();
    expect(startupProjectIdFromSuo(Buffer.concat([key, Buffer.alloc(200), Buffer.from(`{${GUID}}`, 'utf16le')]))).toBeNull();
  });
});
