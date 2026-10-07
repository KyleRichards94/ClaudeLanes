import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TicketRecord } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import { newTicketInput } from '../tickets/testing';
import { createDiffService, parseNameStatus, parseNumstat, safeRelativePath } from './diff';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;
let tickets: TicketRecordStore;
let ticketPath: string;
const BRANCH = '71273-cutover';
const BASE = { kind: 'base' } as const;

function service(maxFileBytes?: number) {
  return createDiffService({ git: createGitService({ runner: repo.git }), tickets, maxFileBytes });
}

beforeEach(async () => {
  repo = await createTempRepo();
  await repo.write('src/JobControl.vb', 'Public Class JobControl\nEnd Class\n');
  await repo.write('src/Old.vb', 'old\nfile\nwith\nlines\n');
  await repo.write('logo.png', 'PNG\0\0binary');
  await repo.commit('Legacy code');
  ticketPath = join(repo.root, '.agent-lanes', '71273');
  await repo.exec(['worktree', 'add', '--quiet', '-b', BRANCH, ticketPath, 'main']);
  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  const created = await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: BRANCH, worktreePath: ticketPath }));
  if (!created.ok) throw new Error(created.message);
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('diff against the base', () => {
  it('lists committed, uncommitted and untracked changes with status and line counts, from the merge base', async () => {
    await repo.write('src/JobControl.razor', '<h1>Jobs</h1>\n<p>grid</p>\n', ticketPath);
    await repo.exec(['rm', '--quiet', 'src/Old.vb'], ticketPath);
    await repo.exec(['mv', 'src/JobControl.vb', 'src/JobControlLegacy.vb'], ticketPath);
    await repo.commit('Cut over', ticketPath);
    await repo.write('src/JobControlLegacy.vb', 'Public Class JobControl\n  Sub New()\nEnd Class\n', ticketPath);
    await repo.write('notes.md', 'one\ntwo\nthree\n', ticketPath);
    // Main moves on: its changes are not the ticket's.
    await repo.write('teammate.txt', 'not ours\n');
    await repo.commit('Teammate change');

    const result = await service().files('71273', BASE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ fromRef: 'main', toRef: BRANCH, includesUncommitted: true, truncated: false });
    expect(result.data.files).toEqual([
      { path: 'notes.md', oldPath: null, status: 'untracked', additions: 3, deletions: 0, binary: false },
      { path: 'src/JobControl.razor', oldPath: null, status: 'added', additions: 2, deletions: 0, binary: false },
      { path: 'src/JobControlLegacy.vb', oldPath: 'src/JobControl.vb', status: 'renamed', additions: 1, deletions: 0, binary: false },
      { path: 'src/Old.vb', oldPath: null, status: 'deleted', additions: 0, deletions: 4, binary: false },
    ]);
    expect(result.data.totals).toEqual({ files: 4, additions: 6, deletions: 4 });
  });

  it('returns one file as a unified diff on demand', async () => {
    await repo.write('src/JobControl.vb', 'Public Class JobControl\n  Sub Load()\nEnd Class\n', ticketPath);

    const result = await service().file('71273', BASE, 'src/JobControl.vb');

    expect(result.ok && result.data.kind).toBe('text');
    const patch = result.ok && result.data.kind === 'text' ? result.data.patch : '';
    expect(patch).toContain('--- a/src/JobControl.vb');
    expect(patch).toContain('+  Sub Load()');
  });

  it('shows a binary file as a placeholder, never its bytes', async () => {
    await writeFile(join(ticketPath, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2, 3]));
    await writeFile(join(ticketPath, 'icon.ico'), Buffer.from([0, 0, 1, 0, 1]));

    const files = await service().files('71273', BASE);
    expect(files.ok && files.data.files).toEqual([
      { path: 'icon.ico', oldPath: null, status: 'untracked', additions: null, deletions: null, binary: true },
      { path: 'logo.png', oldPath: null, status: 'modified', additions: null, deletions: null, binary: true },
    ]);

    expect(await service().file('71273', BASE, 'logo.png')).toEqual({ ok: true, data: { kind: 'binary', path: 'logo.png' } });
    expect(await service().file('71273', BASE, 'icon.ico')).toEqual({ ok: true, data: { kind: 'binary', path: 'icon.ico' } });
  });

  it('shows a very large diff as a placeholder, never the raw content', async () => {
    const big = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    await repo.write('src/Generated.cs', `${big}\n`, ticketPath);
    await repo.commit('Generated code', ticketPath);
    await repo.write('src/Untracked.cs', `${big}\n`, ticketPath);

    const committed = await service(4_096).file('71273', BASE, 'src/Generated.cs');
    const untracked = await service(4_096).file('71273', BASE, 'src/Untracked.cs');

    expect(committed).toEqual({ ok: true, data: { kind: 'too-large', path: 'src/Generated.cs', bytes: null, limit: 4_096 } });
    expect(untracked).toMatchObject({ ok: true, data: { kind: 'too-large', path: 'src/Untracked.cs', limit: 4_096 } });
  });

  it('shows an untracked text file as an all-added diff', async () => {
    await repo.write('notes.md', 'one\ntwo', ticketPath);

    const result = await service().file('71273', BASE, 'notes.md');

    expect(result).toEqual({
      ok: true,
      data: {
        kind: 'text',
        path: 'notes.md',
        patch: 'diff --git a/notes.md b/notes.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n',
      },
    });
  });

  it('refuses paths that leave the worktree and reads none of them', async () => {
    for (const path of ['../secrets.txt', 'src/../../x', 'C:\\Windows\\win.ini', '/etc/passwd']) {
      expect(await service().file('71273', BASE, path)).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'invalid-path' } });
    }
  });

  it('uses the branch tip when the worktree folder is gone', async () => {
    await repo.write('a.txt', 'a\n', ticketPath);
    await repo.commit('A', ticketPath);
    await repo.write('uncommitted.txt', 'lost\n', ticketPath);
    await rm(ticketPath, { recursive: true, force: true });

    const result = await service().files('71273', BASE);

    expect(result).toMatchObject({ ok: true, data: { includesUncommitted: false, files: [{ path: 'a.txt', status: 'added' }] } });
  });
});

describe('diff of a sub-branch', () => {
  it("shows only the sub-agent's changes against the ticket branch", async () => {
    await repo.write('ticket.txt', 'ticket\n', ticketPath);
    await repo.commit('Ticket work', ticketPath);
    const subPath = join(repo.root, '.agent-lanes', '71273--grid');
    await repo.exec(['worktree', 'add', '--quiet', '-b', 'sub/71273-grid', subPath, BRANCH]);
    await repo.write('grid.razor', '<Grid />\n', subPath);
    await repo.commit('Grid', subPath);
    await tickets.update('71273', (record): TicketRecord => ({
      ...record,
      subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: subPath, createdAt: 1, mergedAt: null }],
    }));

    const result = await service().files('71273', { kind: 'sub-branch', branch: 'sub/71273-grid' });

    expect(result).toMatchObject({
      ok: true,
      data: { fromRef: BRANCH, toRef: 'sub/71273-grid', files: [{ path: 'grid.razor', status: 'added', additions: 1 }] },
    });
    expect(await service().files('71273', { kind: 'sub-branch', branch: 'sub/71273-other' })).toMatchObject({
      ok: false,
      details: { reason: 'sub-branch-not-found' },
    });
  });
});

describe('diff parsers', () => {
  it('reads -z name-status and numstat output, renames included', () => {
    expect(parseNameStatus('M\0a.cs\0R087\0old.cs\0new.cs\0A\0b c.cs\0')).toEqual([
      { status: 'modified', path: 'a.cs', oldPath: null },
      { status: 'renamed', path: 'new.cs', oldPath: 'old.cs' },
      { status: 'added', path: 'b c.cs', oldPath: null },
    ]);
    expect([...parseNumstat('1\t2\ta.cs\0' + '3\t0\t\0old.cs\0new.cs\0' + '-\t-\tlogo.png\0')]).toEqual([
      ['a.cs', { additions: 1, deletions: 2 }],
      ['new.cs', { additions: 3, deletions: 0 }],
      ['logo.png', { additions: null, deletions: null }],
    ]);
  });

  it('accepts only relative paths inside the worktree', () => {
    expect(safeRelativePath('src/a.cs')).toBe('src/a.cs');
    expect(safeRelativePath('src\\a.cs')).toBe('src/a.cs');
    expect(safeRelativePath('src/../a.cs')).toBe('a.cs');
    expect(safeRelativePath('../a.cs')).toBeNull();
    expect(safeRelativePath('C:/a.cs')).toBeNull();
    expect(safeRelativePath('a\0b')).toBeNull();
  });
});
