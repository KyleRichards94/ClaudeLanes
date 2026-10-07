import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TicketRecord } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import { newTicketInput } from '../tickets/testing';
import { createBranchStatusService, type SubagentActivity } from './branch-status';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git. The first test
// makes about 35 git calls, which took over 90 s in a full `pnpm test` run on a loaded machine.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

let repo: TempRepo;
let tickets: TicketRecordStore;
let ticketPath: string;
const running = new Set<string>();
const subagents: SubagentActivity = { isRunning: (ticketId, name) => running.has(`${ticketId}/${name}`) };

function service() {
  return createBranchStatusService({ git: createGitService({ runner: repo.git }), tickets, subagents, now: () => 1_000 });
}

/** Adds a writer sub-agent's worktree off the ticket branch and records it on the ticket, as AL-084 will. */
async function addSub(name: string, commits: number): Promise<string> {
  const branch = `sub/71273-${name}`;
  const path = join(repo.root, '.agent-lanes', `71273--${name}`);
  await repo.exec(['worktree', 'add', '--quiet', '-b', branch, path, '71273-cutover']);
  for (let i = 0; i < commits; i++) {
    await repo.write(`${name}-${i}.txt`, `${i}\n`, path);
    await repo.commit(`${name} ${i}`, path);
  }
  const updated = await tickets.update('71273', (record): TicketRecord => ({
    ...record,
    subBranches: [...record.subBranches, { name, branch, worktreePath: path, createdAt: record.subBranches.length, mergedAt: null }],
  }));
  if (!updated.ok) throw new Error(updated.message);
  return path;
}

beforeEach(async () => {
  repo = await createTempRepo();
  running.clear();
  ticketPath = join(repo.root, '.agent-lanes', '71273');
  await repo.exec(['worktree', 'add', '--quiet', '-b', '71273-cutover', ticketPath, 'main']);
  await repo.write('ticket.txt', 'ticket\n', ticketPath);
  await repo.commit('Ticket work', ticketPath);
  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  const created = await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: '71273-cutover', worktreePath: ticketPath }));
  if (!created.ok) throw new Error(created.message);
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('branch status', () => {
  it('compares the ticket branch with its base and each sub-branch with the ticket branch', async () => {
    await addSub('filter', 4);
    await addSub('grid', 7);
    // Main moves on after the ticket started: the ticket branch is one behind.
    await repo.write('main.txt', 'main\n');
    await repo.commit('Teammate change');

    const result = await service().status('71273');

    expect(result).toEqual({
      ok: true,
      data: {
        ticketId: '71273',
        ticket: {
          worktreePath: ticketPath,
          present: true,
          dirty: false,
          changedFiles: 0,
          conflicted: false,
          branch: '71273-cutover',
          baseBranch: 'main',
          baseRef: 'main',
          ahead: 1,
          behind: 1,
        },
        subBranches: [
          expect.objectContaining({ name: 'filter', branch: 'sub/71273-filter', ahead: 4, behind: 0, dirty: false, finished: true, ready: true }),
          expect.objectContaining({ name: 'grid', branch: 'sub/71273-grid', ahead: 7, behind: 0, dirty: false, finished: true, ready: true }),
        ],
        checkedAt: 1_000,
      },
    });
  });

  it.each([
    ['an unstaged edit', async (path: string) => void (await repo.write('filter-0.txt', 'changed\n', path))],
    ['a staged edit', async (path: string) => {
      await repo.write('filter-0.txt', 'changed\n', path);
      await repo.exec(['add', '.'], path);
    }],
    ['an untracked file', async (path: string) => void (await repo.write('new.txt', 'new\n', path))],
  ])('a dirty sub-worktree is never Ready (%s), even when its sub-agent finished', async (_, makeDirty) => {
    const path = await addSub('filter', 2);
    await makeDirty(path);

    const result = await service().status('71273');

    expect(result.ok && result.data.subBranches[0]).toMatchObject({ dirty: true, changedFiles: 1, finished: true, ready: false, ahead: 2 });
  });

  it('a clean sub-branch is not Ready while its sub-agent still runs', async () => {
    await addSub('grid', 1);
    running.add('71273/grid');

    const result = await service().status('71273');

    expect(result.ok && result.data.subBranches[0]).toMatchObject({ dirty: false, finished: false, ready: false });
  });

  it('ignored files do not make a worktree dirty', async () => {
    const path = await addSub('grid', 1);
    await repo.write('.gitignore', 'bin/\n', path);
    await repo.commit('Ignore bin', path);
    await repo.write('bin/app.dll', 'binary\n', path);

    const result = await service().status('71273');

    expect(result.ok && result.data.subBranches[0]).toMatchObject({ dirty: false, ready: true, ahead: 2 });
  });

  it('a sub-worktree deleted outside the app is reported missing and never Ready', async () => {
    const path = await addSub('grid', 1);
    await rm(path, { recursive: true, force: true });

    const result = await service().status('71273');

    expect(result.ok && result.data.subBranches[0]).toMatchObject({ present: false, dirty: null, changedFiles: null, ready: false, ahead: 1 });
  });

  it('reports the ticket worktree dirty and the counts as unknown when a branch is gone', async () => {
    await repo.write('wip.txt', 'wip\n', ticketPath);
    await tickets.update('71273', (record) => ({
      ...record,
      subBranches: [{ name: 'gone', branch: 'sub/71273-gone', worktreePath: join(repo.root, 'nowhere'), createdAt: 1, mergedAt: null }],
    }));

    const result = await service().status('71273');

    expect(result.ok && result.data.ticket).toMatchObject({ dirty: true, changedFiles: 1 });
    expect(result.ok && result.data.subBranches[0]).toMatchObject({ ahead: null, behind: null, present: false, ready: false });
  });

  it('compares with origin/<base> when there is no local base branch', async () => {
    await tickets.update('71273', (record) => ({ ...record, baseBranch: 'release' }));
    await repo.exec(['push', '--quiet', 'origin', 'main:release']);
    await repo.exec(['fetch', '--quiet', 'origin']);

    const result = await service().status('71273');

    expect(result.ok && result.data.ticket).toMatchObject({ baseBranch: 'release', baseRef: 'origin/release', ahead: 1, behind: 0 });
  });

  it('refuses an unknown ticket', async () => {
    const result = await service().status('99999');

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found' } });
  });
});
