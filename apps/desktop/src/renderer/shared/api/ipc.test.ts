import { describe, expect, it } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { invoke } from './ipc';

const appInfo = {
  name: 'Agent Lanes',
  version: '0.1.0',
  platform: 'win32',
  versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
};

describe('invoke', () => {
  it('returns the validated payload', async () => {
    installFakeBridge({ 'app:getInfo': { ok: true, data: appInfo } });
    await expect(invoke('app:getInfo')).resolves.toEqual({ ok: true, data: appInfo });
  });

  it('passes typed errors through', async () => {
    installFakeBridge({ 'app:getInfo': { ok: false, code: 'SESSION_LOST', message: 'gone' } });
    await expect(invoke('app:getInfo')).resolves.toEqual({ ok: false, code: 'SESSION_LOST', message: 'gone' });
  });

  it('rejects a payload that breaks the contract', async () => {
    installFakeBridge({ 'app:getInfo': { ok: true, data: { name: 'x' } } });
    const result = await invoke('app:getInfo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('INTERNAL');
  });

  it('rejects a malformed envelope', async () => {
    installFakeBridge({ 'app:getInfo': 'not a result' });
    const result = await invoke('app:getInfo');
    expect(!result.ok && result.code).toBe('INTERNAL');
  });
});
