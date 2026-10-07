import { err, ok } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { handleInvoke } from './handle-invoke';

const appInfo = {
  name: 'Agent Lanes',
  version: '0.1.0',
  platform: 'win32',
  versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
};

describe('handleInvoke', () => {
  it('returns the handler result when request and response match the contract', async () => {
    await expect(handleInvoke('app:getInfo', undefined, () => ok(appInfo))).resolves.toEqual(ok(appInfo));
  });

  it('refuses a request that breaks the contract without calling the handler', async () => {
    let called = false;
    const result = await handleInvoke('app:getInfo', { unexpected: true }, () => {
      called = true;
      return ok(appInfo);
    });
    expect(called).toBe(false);
    expect(!result.ok && result.code).toBe('VALIDATION');
  });

  it('reports a handler response that breaks the contract as INTERNAL', async () => {
    const result = await handleInvoke('app:getInfo', undefined, () => ok({ name: 'only a name' } as never));
    expect(!result.ok && result.code).toBe('INTERNAL');
  });

  it('turns a throw into an INTERNAL result', async () => {
    const result = await handleInvoke('app:getInfo', undefined, () => {
      throw new Error('boom');
    });
    expect(result).toEqual(err('INTERNAL', 'app:getInfo failed: boom'));
  });

  it('passes typed handler errors through untouched', async () => {
    const failure = err('ADO_UNAUTHORIZED', 'PAT expired');
    await expect(handleInvoke('app:getInfo', undefined, () => failure)).resolves.toEqual(failure);
  });

  it('reports refused requests, invalid responses and throws to the log (AL-214)', async () => {
    const lines: Array<[string, string, unknown]> = [];
    const log = {
      warn: (message: string, detail?: unknown) => lines.push(['warn', message, detail]),
      error: (message: string, detail?: unknown) => lines.push(['error', message, detail]),
    };
    const boom = new Error('boom');

    await handleInvoke('app:getInfo', { unexpected: true }, () => ok(appInfo), log);
    await handleInvoke('app:getInfo', undefined, () => ok({ name: 'only a name' } as never), log);
    await handleInvoke('app:getInfo', undefined, () => {
      throw boom;
    }, log);
    await handleInvoke('app:getInfo', undefined, () => err('ADO_UNAUTHORIZED', 'PAT expired'), log);

    expect(lines.map(([level, message]) => [level, message])).toEqual([
      ['warn', 'Refused app:getInfo: the request breaks its contract'],
      ['error', 'Handler for app:getInfo returned an invalid response'],
      ['error', 'app:getInfo failed: boom'],
    ]);
    expect(lines[2]?.[2]).toBe(boom);
  });
});

