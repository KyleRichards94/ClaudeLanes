import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ArchiveTicketRequestSchema, type TicketRecord } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from '../git/git-error';
import type { GitRunner } from '../git/git-runner';
import { createGitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketArchive, type TicketArchive } from '../tickets/archive-store';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import { newTicketInput } from '../tickets/testing';
import { createArchiveService } from './archive';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;
let tickets: TicketRecordStore;
let archive: TicketArchive;
let ticketPath: string;
let subPath: string;
const BRANCH = '71273-cutover';
const SUB = 'sub/71273-grid';

function service(runner?: (real: GitRunner) => GitRunner, removeFolder?: (path: string) => Promise<void>) {
  return createArchiveService({
    git: createGitService({ runner: runner ? runner(repo.git) : repo.git }),
    removeFolder,
    tickets,
    archive,
    now: () => 5_000,
    log: { info: () => undefined, warn: () => undefined },
    retryDelaysMs: [0, 0],
  });
}

const branches = () => repo.exec(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
const worktreeList = () => repo.exec(['worktree', 'list', '--porcelain']);

/** Merges the sub-branch into the ticket branch and the ticket branch into main, as AL-086/AL-087 would. */
async function mergeEverything() {
  await repo.exec(['merge', '--quiet', '--no-ff', '--no-edit', SUB], ticketPath);
  await repo.exec(['merge', '--quiet', '--no-ff', '--no-edit', BRANCH]);
}

beforeEach(async () => {
  repo = await createTempRepo();
  ticketPath = join(repo.root, '.agent-lanes', '71273');
  subPath = join(repo.root, '.agent-lanes', '71273--grid');
  await repo.exec(['worktree', 'add', '--quiet', '-b', BRANCH, ticketPath, 'main']);
  await repo.write('ticket.txt', 'ticket\n', ticketPath);
  await repo.commit('Ticket work', ticketPath);
  await repo.exec(['worktree', 'add', '--quiet', '-b', SUB, subPath, BRANCH]);
  await repo.write('grid.txt', 'grid\n', subPath);
  await repo.commit('Grid work', subPath);

  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  archive = createTicketArchive({ rootDir: join(repo.root, 'user-data', 'tickets-archive'), warn: () => undefined });
  const created = await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: BRANCH, worktreePath: ticketPath }));
  if (!created.ok) throw new Error(created.message);
  await tickets.update('71273', (record): TicketRecord => ({
    ...record,
    stage: 'done',
    subBranches: [{ name: 'grid', branch: SUB, worktreePath: subPath, createdAt: 1, mergedAt: 2 }],
  }));
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('archive', () => {
  it('removes the ticket worktree and its sub-worktrees, deletes merged branches and moves the record to the archive list', async () => {
    await mergeEverything();

    const result = await service().archive('71273', { deleteMergedBranches: true });

    expect(result).toMatchObject({
      ok: true,
      data: { status: 'archived', archived: { archivedAt: 5_000, deletedBranches: [SUB, BRANCH], keptBranches: [], record: { id: '71273' } } },
    });
    expect(existsSync(ticketPath)).toBe(false);
    expect(existsSync(subPath)).toBe(false);
    expect(await worktreeList()).not.toContain('.agent-lanes');
    expect(await branches()).toBe('main');
    expect(await tickets.get('71273')).toBeUndefined();
    expect(await archive.list()).toMatchObject([{ archivedAt: 5_000, record: { id: '71273', branch: BRANCH } }]);
  });

  it('keeps merged branches unless asked to delete them', async () => {
    await mergeEverything();

    const result = await service().archive('71273');

    expect(result).toMatchObject({ ok: true, data: { status: 'archived', archived: { deletedBranches: [], keptBranches: [SUB, BRANCH] } } });
    expect((await branches()).split('\n').sort()).toEqual([BRANCH, 'main', SUB].sort());
  });

  it('refuses while branches have unmerged commits, and archives on the second confirmation', async () => {
    const first = await service().archive('71273', { deleteMergedBranches: true });

    expect(first).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      details: { reason: 'unmerged-work', branches: [{ branch: BRANCH, commits: 1 }, { branch: SUB, commits: 1 }], dirtyWorktrees: [] },
    });
    // Nothing was touched.
    expect(existsSync(ticketPath) && existsSync(subPath)).toBe(true);
    expect(await tickets.get('71273')).toBeDefined();

    const second = await service().archive('71273', { discardUnmerged: true, deleteMergedBranches: true });

    expect(second).toMatchObject({ ok: true, data: { status: 'archived', archived: { deletedBranches: [], keptBranches: [SUB, BRANCH] } } });
    expect(existsSync(ticketPath) || existsSync(subPath)).toBe(false);
    // Unmerged branches are kept, so no commit is lost.
    expect((await branches()).split('\n').sort()).toEqual([BRANCH, 'main', SUB].sort());
  });

  it('counts uncommitted changes as unmerged work', async () => {
    await mergeEverything();
    await repo.write('wip.txt', 'wip\n', subPath);

    const first = await service().archive('71273');
    expect(first).toMatchObject({ ok: false, details: { reason: 'unmerged-work', branches: [], dirtyWorktrees: [subPath] } });

    const second = await service().archive('71273', { discardUnmerged: true });
    expect(second).toMatchObject({ ok: true, data: { status: 'archived' } });
    expect(existsSync(subPath)).toBe(false);
  });

  it('retries a locked worktree, and reports a partial removal while keeping the ticket on the board', async () => {
    await mergeEverything();
    let failures = 0;
    const locked = (real: GitRunner): GitRunner => (args, options) => {
      if (args.includes('remove') && args.at(-1) === subPath) {
        failures += 1;
        return Promise.reject(new GitError('COMMAND_FAILED', 'git worktree remove failed', { exitCode: 128, stderr: "error: failed to delete 'grid.txt': Permission denied" }));
      }
      return real(args, options);
    };

    const removals: string[] = [];
    const stillLocked = async (path: string) => {
      removals.push(path);
      throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${path}'`), { code: 'EBUSY' });
    };

    const result = await service(locked, stillLocked).archive('71273');

    // Tried once plus once per retry delay, each time also with Node's own removal.
    expect(failures).toBe(3);
    expect(removals).toEqual([subPath, subPath, subPath]);
    expect(result).toEqual({
      ok: true,
      data: {
        status: 'partial',
        removedWorktrees: [ticketPath],
        leftovers: [{ kind: 'worktree', target: subPath, reason: `EBUSY: resource busy or locked, rmdir '${subPath}'` }],
      },
    });
    expect(await tickets.get('71273')).toBeDefined();
    expect(await archive.list()).toEqual([]);

    // Run again once the lock is gone: only the leftover is left to remove.
    const again = await service().archive('71273');
    expect(again).toMatchObject({ ok: true, data: { status: 'archived' } });
    expect(existsSync(subPath)).toBe(false);
  });

  it("finishes with Node's removal when git cannot delete a file, e.g. a path too long for git", async () => {
    await mergeEverything();
    const tooLong = (real: GitRunner): GitRunner => (args, options) =>
      args.includes('remove') && args.at(-1) === subPath
        ? Promise.reject(new GitError('COMMAND_FAILED', 'git worktree remove failed', { exitCode: 128, stderr: 'error: Filename too long' }))
        : real(args, options);

    const result = await service(tooLong).archive('71273');

    expect(result).toMatchObject({ ok: true, data: { status: 'archived' } });
    expect(existsSync(subPath)).toBe(false);
    expect(await worktreeList()).not.toContain('71273--grid');
  });

  it('a worktree whose folder is already gone counts as removed', async () => {
    await mergeEverything();
    await repo.exec(['worktree', 'remove', subPath]);

    const result = await service().archive('71273');

    expect(result).toMatchObject({ ok: true, data: { status: 'archived' } });
  });

  it('never runs without the user: the channel needs confirmed: true', () => {
    expect(ArchiveTicketRequestSchema.safeParse({ ticketId: '71273' }).success).toBe(false);
    expect(ArchiveTicketRequestSchema.safeParse({ ticketId: '71273', confirmed: false }).success).toBe(false);
    expect(ArchiveTicketRequestSchema.safeParse({ ticketId: '71273', confirmed: true }).success).toBe(true);
  });

  it('refuses an unknown ticket', async () => {
    expect(await service().archive('99999')).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found' } });
  });
});
