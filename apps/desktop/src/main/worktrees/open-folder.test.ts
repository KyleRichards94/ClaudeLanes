import { describe, expect, it, vi } from 'vitest';
import { memoryTickets } from '../agent/testing/sessions';
import { createWorktreeOpener } from './open-folder';

describe('open worktree folder (AL-267)', () => {
  it('opens the worktree through the OS, refuses a missing one, and reports what the OS said', async () => {
    const tickets = await memoryTickets({ id: '71273' });
    const worktree = (await tickets.get('71273'))!.worktreePath;
    const openPath = vi.fn(async () => '');
    const opener = createWorktreeOpener({ tickets, openPath, exists: (path) => path === worktree });

    await expect(opener.open('71273')).resolves.toEqual({ ok: true, data: { path: worktree } });
    expect(openPath).toHaveBeenCalledWith(worktree);
    await expect(opener.open('nope')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });

    const gone = createWorktreeOpener({ tickets, openPath, exists: () => false });
    await expect(gone.open('71273')).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'worktree-missing' } });
    expect(openPath).toHaveBeenCalledOnce();

    const refused = createWorktreeOpener({ tickets, openPath: async () => 'Access is denied.', exists: () => true });
    await expect(refused.open('71273')).resolves.toMatchObject({ ok: false, code: 'INTERNAL', message: 'The folder could not be opened: Access is denied.' });
  });
});
