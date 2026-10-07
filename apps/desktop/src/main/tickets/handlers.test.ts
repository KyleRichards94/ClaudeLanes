import { describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import type { Services } from '../services';
import { createTicketsHandlers } from './handlers';
import { createTicketRecordStore } from './record-store';
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
