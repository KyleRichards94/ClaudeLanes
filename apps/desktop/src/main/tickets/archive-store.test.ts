import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTicketArchive } from './archive-store';
import { createTicketRecord } from './record';
import { createMemoryRecordFs, newTicketInput } from './testing';

const BASE = join('/', 'data');
const ROOT = join(BASE, 'tickets-archive');

describe('ticket archive list', () => {
  it('lists archived tickets newest first, keeping each archive of a reused id, and skips unreadable files', async () => {
    const fs = createMemoryRecordFs();
    const warnings: string[] = [];
    const archive = createTicketArchive({ rootDir: ROOT, fs, warn: (message) => warnings.push(message) });
    const record = createTicketRecord(newTicketInput(BASE), 1_000);

    await archive.add({ archivedAt: 2_000, record, deletedBranches: [record.branch], keptBranches: [] });
    await archive.add({ archivedAt: 3_000, record, deletedBranches: [], keptBranches: [record.branch] });
    const folder = dirname([...fs.files.keys()][0] ?? join(ROOT, 'repo', 'x.json'));
    fs.files.set(join(folder, 'broken.json'), '{ not json');

    const listed = await archive.list();

    expect(listed.map((entry) => entry.archivedAt)).toEqual([3_000, 2_000]);
    expect(listed[0]?.record.id).toBe('71273');
    expect(warnings).toHaveLength(1);
  });

  it('is empty before anything is archived', async () => {
    expect(await createTicketArchive({ rootDir: ROOT, fs: createMemoryRecordFs() }).list()).toEqual([]);
  });
});
