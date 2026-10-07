import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONNECTIONS_INVOKE_CHANNELS, type EventChannel } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createMemoryConnectionsFile } from './connections-file';
import { createConnectionsHandlers } from './handlers';
import { createConnectionsService } from './service';

/** Made up for the test; valid nowhere. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const PAT_2 = 'fakepat9999second8888token7777for6666replace5555Zx9K';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-connections-ipc-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const events: Array<{ channel: EventChannel; payload: unknown }> = [];
  const service = createConnectionsService({
    file: createMemoryConnectionsFile(),
    secrets: createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }) }),
    emit: (channel, payload) => events.push({ channel, payload }),
    testers: { ado: async () => ({ status: 'ok', identity: 'Kyle Richards', message: null }) },
    warn: () => undefined,
  });
  return { handlers: createConnectionsHandlers(service), events };
}

describe('connections IPC handlers', () => {
  it('has a handler for every connections channel', () => {
    const { handlers } = setup();
    expect(Object.keys(handlers).sort()).toEqual([...CONNECTIONS_INVOKE_CHANNELS].sort());
  });

  it('runs a whole add, test, replace and remove through the contracts with no token in any reply', async () => {
    const { handlers, events } = setup();
    const replies: unknown[] = [];
    async function call<C extends (typeof CONNECTIONS_INVOKE_CHANNELS)[number]>(channel: C, request: unknown) {
      const reply = await handleInvoke(channel, request, handlers[channel]);
      replies.push(reply);
      return reply;
    }

    const draft = { kind: 'ado', orgUrl: 'https://dev.azure.com/CompanionSystems', pat: PAT };
    expect(await call('connections:list', undefined)).toEqual({ ok: true, data: [] });
    expect(await call('connections:test', { draft })).toMatchObject({ ok: true, data: { status: 'ok', identity: 'Kyle Richards' } });
    expect(await call('connections:save', draft)).toMatchObject({
      ok: true,
      data: { id: 'ado:companionsystems', status: 'ok', identity: 'Kyle Richards', maskedToken: '••••••••7Fq2' },
    });
    expect(await call('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ ok: true, data: { status: 'ok' } });
    expect(await call('connections:replace', { id: 'ado:companionsystems', draft: { ...draft, pat: PAT_2 } })).toMatchObject({
      ok: true,
      data: { maskedToken: '••••••••Zx9K', status: 'untested' },
    });
    expect(await call('connections:list', undefined)).toMatchObject({ ok: true, data: [{ id: 'ado:companionsystems' }] });
    expect(await call('connections:remove', { id: 'ado:companionsystems' })).toEqual({ ok: true, data: { id: 'ado:companionsystems', removed: true } });
    expect(await call('connections:list', undefined)).toEqual({ ok: true, data: [] });

    const sent = JSON.stringify({ replies, events });
    expect(sent).not.toContain(PAT);
    expect(sent).not.toContain(PAT_2);
    expect(events.map((event) => event.channel)).toEqual(['connections:changed', 'connections:changed', 'connections:changed', 'connections:changed']);
  });

  it('refuses requests outside the contract before they reach the service', async () => {
    const { handlers } = setup();
    const results = await Promise.all([
      handleInvoke('connections:save', { kind: 'ado', orgUrl: 'https://dev.azure.com/contoso' }, handlers['connections:save']),
      handleInvoke('connections:save', { kind: 'github', token: PAT }, handlers['connections:save']),
      handleInvoke('connections:test', {}, handlers['connections:test']),
      handleInvoke('connections:replace', { id: 'ado:contoso' }, handlers['connections:replace']),
      handleInvoke('connections:remove', { id: '../secrets' }, handlers['connections:remove']),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(JSON.stringify(results)).not.toContain(PAT);
  });
});
