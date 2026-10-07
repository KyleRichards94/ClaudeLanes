import { ok } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import type { Services } from '../services';
import { createTicketsHandlers } from './handlers';
import { createTicketRecordStore, type TicketRecordStore } from './record-store';
import { createTempDir, newTicketInput } from './testing';

describe('tickets IPC handlers', () => {
  it('tickets:list returns every record, oldest first, through the contract', async () => {
    const temp = await createTempDir();
    const tickets = createTicketRecordStore({ rootDir: `${temp.dir}/tickets`, warn: () => undefined });
    try {
      const first = await tickets.create(newTicketInput(temp.dir));
      const second = await tickets.create(newTicketInput(temp.dir, { id: '71288', title: 'Job grid filter drops date range' }));
      expect(first.ok && second.ok).toBe(true);

      // Archive (AL-088) and reconciliation (AL-090) have their own tests; tickets:list doesn't touch them.
      const unused = {} as Pick<Services, 'archive' | 'ticketArchive' | 'reconcile'>;
      const handlers = createTicketsHandlers({ tickets, ...unused });
      const listed = await handleInvoke('tickets:list', undefined, handlers['tickets:list']);
      expect(listed.ok).toBe(true);
      expect(listed.ok && listed.data.map((record) => record.id)).toEqual(['71273', '71288']);

      // The request carries nothing.
      await expect(handleInvoke('tickets:list', { repo: 'x' }, handlers['tickets:list'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    } finally {
      await tickets.dispose();
      await temp.remove();
    }
  });
});

// Archive (AL-088) and reconciliation (AL-090) are not used by tickets:get.
const unusedServices = {} as Pick<Services, 'archive' | 'ticketArchive' | 'reconcile'>;

describe('tickets:get (AL-170)', () => {
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

    const result = await handleInvoke('tickets:get', { ticketId: '71273' }, createTicketsHandlers({ tickets, ...unusedServices })['tickets:get']);

    expect(result).toEqual(ok({ record: created.ok ? created.data : null }));
  });

  it('tickets:get returns null for an unknown ticket', async () => {
    const { store: tickets } = await setUp();
    const result = await handleInvoke('tickets:get', { ticketId: '99999' }, createTicketsHandlers({ tickets, ...unusedServices })['tickets:get']);
    expect(result).toEqual(ok({ record: null }));
  });

  it('tickets:get refuses an id that is not a ticket id', async () => {
    const { store: tickets } = await setUp();
    const result = await handleInvoke('tickets:get', { ticketId: '../secrets' }, createTicketsHandlers({ tickets, ...unusedServices })['tickets:get']);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
