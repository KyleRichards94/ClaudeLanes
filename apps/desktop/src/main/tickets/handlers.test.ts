import { ok } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createTicketsHandlers } from './handlers';
import { createTicketRecordStore, type TicketRecordStore } from './record-store';
import { createTempDir, newTicketInput } from './testing';

describe('tickets IPC handlers', () => {
  let cleanup: (() => Promise<void>) | undefined;
  let store: TicketRecordStore | undefined;

  afterEach(async () => {
    await store?.dispose();
    await cleanup?.();
    store = undefined;
    cleanup = undefined;
  });

  async function setUp() {
    const temp = await createTempDir();
    cleanup = temp.remove;
    store = createTicketRecordStore({ rootDir: temp.dir, warn: () => undefined });
    return { store, base: temp.dir };
  }

  it('tickets:get returns the record', async () => {
    const { store: tickets, base } = await setUp();
    const created = await tickets.create(newTicketInput(base));
    expect(created.ok).toBe(true);

    const result = await handleInvoke('tickets:get', { ticketId: '71273' }, createTicketsHandlers({ tickets })['tickets:get']);

    expect(result).toEqual(ok({ record: created.ok ? created.data : null }));
  });

  it('tickets:get returns null for an unknown ticket', async () => {
    const { store: tickets } = await setUp();
    const result = await handleInvoke('tickets:get', { ticketId: '99999' }, createTicketsHandlers({ tickets })['tickets:get']);
    expect(result).toEqual(ok({ record: null }));
  });

  it('tickets:get refuses an id that is not a ticket id', async () => {
    const { store: tickets } = await setUp();
    const result = await handleInvoke('tickets:get', { ticketId: '../secrets' }, createTicketsHandlers({ tickets })['tickets:get']);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
