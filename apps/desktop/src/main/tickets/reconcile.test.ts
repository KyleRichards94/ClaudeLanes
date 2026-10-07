import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSettings, type Settings, type TicketRecord } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createRepoSettings } from '../settings/repo-settings';
import { createReconcileService } from './reconcile';
import { createTicketRecordStore, type TicketRecordStore } from './record-store';
import { newTicketInput } from './testing';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;
let root: string;
let settingsDoc: Settings;
let tickets: TicketRecordStore;
const ticketsDir = () => join(repo.root, 'user-data', 'tickets');

function service(store: TicketRecordStore = tickets) {
  return createReconcileService({
    git: createGitService({ runner: repo.git }),
    settings: { get: () => settingsDoc },
    tickets: store,
    ignoredFile: join(repo.root, 'user-data', 'ignored-worktrees.json'),
    now: () => 7_000,
  });
}

async function addWorktree(folder: string, branch: string, from = 'main'): Promise<string> {
  const path = join(root, folder);
  await repo.exec(['worktree', 'add', '--quiet', '-b', branch, path, from]);
  return path;
}

beforeEach(async () => {
  repo = await createTempRepo();
  root = join(repo.root, '.agent-lanes');
  settingsDoc = defaultSettings();
  settingsDoc.repos = [createRepoSettings(repo.dir, { baseBranch: 'main' })];
  tickets = createTicketRecordStore({ rootDir: ticketsDir(), warn: () => undefined });
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('start-up reconciliation', () => {
  it('restarting shows the same board: stage, model/effort and session id come back, and nothing is flagged', async () => {
    const path = await addWorktree('71273', '71273-cutover');
    const subPath = await addWorktree('71273--grid', 'sub/71273-grid', '71273-cutover');
    await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: '71273-cutover', worktreePath: path }));
    for (const stage of ['planning', 'implementing'] as const) await tickets.update('71273', (record) => ({ ...record, stage }));
    await tickets.update('71273', (record): TicketRecord => ({
      ...record,
      model: 'sonnet',
      effort: 'high',
      sessionId: 'cc-71273',
      subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: subPath, createdAt: 1, mergedAt: null }],
    }));
    const before = await service().board();
    await tickets.dispose();

    // A restart: a new store reads the records from disk.
    const restarted = createTicketRecordStore({ rootDir: ticketsDir(), warn: () => undefined });
    const after = await service(restarted).board();
    await restarted.dispose();

    expect(after).toEqual(before);
    expect(after).toMatchObject({
      ok: true,
      data: {
        tickets: [{ id: '71273', stage: 'implementing', model: 'sonnet', effort: 'high', sessionId: 'cc-71273' }],
        missingWorktrees: [],
        orphans: [],
        recordIssues: [],
        unreadableRepos: [],
      },
    });
  });

  it('flags a record whose worktree or sub-worktree is gone as "Worktree missing"', async () => {
    const path = await addWorktree('71273', '71273-cutover');
    const subPath = join(root, '71273--grid');
    await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: '71273-cutover', worktreePath: path }));
    await tickets.update('71273', (record): TicketRecord => ({
      ...record,
      subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: subPath, createdAt: 1, mergedAt: null }],
    }));
    // Deleted outside the app: git still lists it (prunable) but the folder is gone.
    await rm(path, { recursive: true, force: true });

    const result = await service().board();

    expect(result.ok && result.data.missingWorktrees).toEqual([
      { ticketId: '71273', worktreePath: path, subBranch: null },
      { ticketId: '71273', worktreePath: subPath, subBranch: 'sub/71273-grid' },
    ]);
    // The ticket itself is still on the board.
    expect(result.ok && result.data.tickets.map((record) => record.id)).toEqual(['71273']);
  });

  it('offers a worktree under the worktree folder without a record for Adopt or Ignore, and leaves other worktrees alone', async () => {
    const orphan = await addWorktree('71300', '71300-paging');
    await repo.exec(['worktree', 'add', '--quiet', '-b', 'elsewhere', join(repo.root, 'elsewhere'), 'main']);

    const result = await service().board();

    expect(result.ok && result.data.orphans).toEqual([
      { repo: repo.dir, worktreePath: orphan, branch: '71300-paging', head: expect.any(String), ticketId: '71300', parentTicketId: null },
    ]);
  });

  it('Adopt makes the orphan a ticket with the default model and effort', async () => {
    const orphan = await addWorktree('71300', '71300-paging');

    const adopted = await service().adopt(orphan);

    expect(adopted).toMatchObject({
      ok: true,
      data: { adoptedAs: 'ticket', record: { id: '71300', branch: '71300-paging', worktreePath: orphan, baseBranch: 'main', model: 'opus', stage: 'queued' } },
    });
    const board = await service().board();
    expect(board.ok && board.data.orphans).toEqual([]);
    expect(board.ok && board.data.tickets.map((record) => record.id)).toEqual(['71300']);
  });

  it("Adopt adds a <ticket>--<name> sub-agent worktree to that ticket's sub-branches", async () => {
    const path = await addWorktree('71273', '71273-cutover');
    await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: '71273-cutover', worktreePath: path }));
    const sub = await addWorktree('71273--grid', 'sub/71273-grid', '71273-cutover');

    const board = await service().board();
    expect(board.ok && board.data.orphans).toMatchObject([{ worktreePath: sub, ticketId: null, parentTicketId: '71273' }]);

    const adopted = await service().adopt(sub);
    expect(adopted).toMatchObject({
      ok: true,
      data: { adoptedAs: 'sub-branch', record: { id: '71273', subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: sub, createdAt: 7_000 }] } },
    });
  });

  it('Ignore hides the orphan from later reconciliations without touching it', async () => {
    const orphan = await addWorktree('scratch', 'scratch');

    expect(await service().ignore(orphan)).toEqual({ ok: true, data: { ignored: [orphan] } });

    const board = await service().board();
    expect(board.ok && board.data.orphans).toEqual([]);
    expect(await repo.exec(['worktree', 'list', '--porcelain'])).toContain('scratch');
  });

  it('refuses to adopt something that is not an orphan, or a detached worktree', async () => {
    expect(await service().adopt(join(root, 'nothing'))).toMatchObject({ ok: false, details: { reason: 'not-an-orphan' } });
    const detached = join(root, 'detached');
    await repo.exec(['worktree', 'add', '--quiet', '--detach', detached, 'main']);
    expect(await service().adopt(detached)).toMatchObject({ ok: false, details: { reason: 'detached' } });
  });

  it('reports a repo git cannot read, and still lists its tickets', async () => {
    await tickets.create(newTicketInput(repo.root, { repo: join(repo.root, 'gone-repo'), branch: 'x', worktreePath: join(repo.root, 'gone-wt') }));

    const result = await service().board();

    expect(result.ok && result.data.unreadableRepos).toMatchObject([{ repo: join(repo.root, 'gone-repo') }]);
    expect(result.ok && result.data.missingWorktrees).toEqual([{ ticketId: '71273', worktreePath: join(repo.root, 'gone-wt'), subBranch: null }]);
  });
});
