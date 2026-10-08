import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService, type GitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import { newTicketInput } from '../tickets/testing';
import { createBranchStatusService } from './branch-status';
import { conflictHandOffMessage, createMergeSubBranchesService, type MergeSubBranchesServiceOptions } from './merge-sub-branches';
import { createSubWorktreeService } from './sub-worktree';

// Real git: every call is a process spawn (slow on Windows with antivirus).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

let repo: TempRepo;
let git: GitService;
let tickets: TicketRecordStore;
let ticketPath: string;
const running = new Set<string>();
const sent: Array<{ ticketId: string; text: string }> = [];
const opened: string[] = [];

beforeEach(async () => {
  repo = await createTempRepo();
  git = createGitService({ runner: repo.git });
  running.clear();
  sent.length = 0;
  opened.length = 0;
  ticketPath = join(repo.root, '.agent-lanes', '71273');
  await repo.exec(['worktree', 'add', '--quiet', '-b', '71273-cutover', ticketPath, 'main']);
  await repo.write('JobControl.razor', 'line 1\nline 2\nline 3\n', ticketPath);
  await repo.commit('Ticket work', ticketPath);
  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  const created = await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: '71273-cutover', worktreePath: ticketPath }));
  if (!created.ok) throw new Error(created.message);
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

function services(overrides: Partial<MergeSubBranchesServiceOptions> = {}) {
  let clock = 5_000;
  const subs = createSubWorktreeService({ git, tickets, now: () => clock++, log: { info: () => undefined, warn: () => undefined } });
  const branches = createBranchStatusService({ git, tickets, subagents: { isRunning: (ticketId, name) => running.has(`${ticketId}/${name}`) } });
  const merge = createMergeSubBranchesService({
    git,
    tickets,
    branches,
    sessions: { send: (ticketId, message) => (sent.push({ ticketId, text: message.text }), ok({ held: false })) },
    openPath: async (path) => (opened.push(path), ''),
    now: () => 9_000,
    log: { info: () => undefined, warn: () => undefined },
    ...overrides,
  });
  return { subs, branches, merge };
}

/** A writer sub-agent's worktree with one commit writing `files`. */
async function subWith(subs: ReturnType<typeof services>['subs'], name: string, files: Record<string, string>): Promise<string> {
  const created = await subs.create('71273', name);
  if (!created.ok) throw new Error(created.message);
  for (const [file, content] of Object.entries(files)) await repo.write(file, content, created.data.worktreePath);
  await repo.commit(`${name} work`, created.data.worktreePath);
  return created.data.branch;
}

async function log(cwd = ticketPath): Promise<string[]> {
  return (await repo.exec(['log', '--format=%s', '--first-parent'], cwd)).split('\n');
}

describe('merge sub-branches → ticket branch (AL-086)', () => {
  it('merges every ready sub-branch with --no-ff in creation order and records when', async () => {
    const { subs, merge, branches } = services();
    const grid = await subWith(subs, 'grid', { 'Grid.razor': '<grid />\n' });
    const tests = await subWith(subs, 'tests', { 'GridTests.cs': '// tests\n' });

    const result = await merge.merge('71273');
    expect(result).toMatchObject({ ok: true, data: { target: '71273-cutover', skipped: [] } });
    expect(result.ok && result.data.merged.map((entry) => entry.branch)).toEqual([grid, tests]);

    // Two merge commits on the ticket branch, oldest sub-branch first.
    expect((await log()).slice(0, 2)).toEqual([`Merge ${tests} into 71273-cutover`, `Merge ${grid} into 71273-cutover`]);
    expect(await repo.exec(['rev-list', '--count', '--merges', 'main..71273-cutover'])).toBe('2');
    expect(await readFile(join(ticketPath, 'Grid.razor'), 'utf8')).toBe('<grid />\n');
    expect((await tickets.get('71273'))?.subBranches.map((sub) => sub.mergedAt)).toEqual([9_000, 9_000]);

    // Branch status now has nothing ahead; merging again merges nothing.
    const status = await branches.status('71273');
    expect(status.ok && status.data.subBranches.map((sub) => sub.ahead)).toEqual([0, 0]);
    expect(await merge.merge('71273')).toMatchObject({ ok: true, data: { merged: [], skipped: [{ reason: 'nothing-to-merge' }, { reason: 'nothing-to-merge' }] } });
  });

  it('skips a sub-branch whose sub-agent still runs or whose worktree is dirty', async () => {
    const { subs, merge } = services();
    const grid = await subWith(subs, 'grid', { 'Grid.razor': '<grid />\n' });
    const tests = await subWith(subs, 'tests', { 'GridTests.cs': '// tests\n' });
    const filter = await subWith(subs, 'filter', { 'Filter.cs': '// filter\n' });
    running.add('71273/tests');
    await repo.write('Filter.cs', '// half done\n', join(repo.root, '.agent-lanes', '71273--filter'));

    const result = await merge.merge('71273');
    expect(result).toMatchObject({
      ok: true,
      data: {
        merged: [{ branch: grid }],
        skipped: [
          { branch: tests, reason: 'not-ready' },
          { branch: filter, reason: 'not-ready' },
        ],
      },
    });
  });

  it('after a conflict, nothing past the conflicting branch is merged and the merge stays in progress', async () => {
    const { subs, merge } = services();
    const grid = await subWith(subs, 'grid', { 'Grid.razor': '<grid />\n' });
    const first = await subWith(subs, 'header', { 'JobControl.razor': 'line 1\nheader version\nline 3\n' });
    const second = await subWith(subs, 'footer', { 'JobControl.razor': 'line 1\nfooter version\nline 3\n' });
    const last = await subWith(subs, 'tests', { 'GridTests.cs': '// tests\n' });

    const result = await merge.merge('71273');
    expect(result).toMatchObject({
      ok: false,
      code: 'MERGE_CONFLICT',
      details: { reason: 'conflict', branch: second, files: ['JobControl.razor'], fileCount: 1, merged: [{ branch: grid }, { branch: first }] },
    });

    // The conflicting merge is left in progress in the ticket worktree…
    expect(await repo.exec(['rev-parse', '--verify', 'MERGE_HEAD'], ticketPath)).toBe(await repo.exec(['rev-parse', second]));
    expect(await readFile(join(ticketPath, 'JobControl.razor'), 'utf8')).toContain('<<<<<<<');
    // …and the branch after it was not merged.
    expect(await repo.exec(['merge-base', '--is-ancestor', last, '71273-cutover']).catch(() => 'not merged')).toBe('not merged');
    const record = await tickets.get('71273');
    expect(record?.subBranches.map((sub) => [sub.branch, sub.mergedAt])).toEqual([
      [grid, 9_000],
      [first, 9_000],
      [second, null],
      [last, null],
    ]);

    // Running it again refuses until the conflict is resolved.
    expect(await merge.merge('71273')).toMatchObject({ ok: false, code: 'MERGE_CONFLICT', details: { reason: 'merge-in-progress', files: ['JobControl.razor'] } });
  });

  it('"Hand to lead agent" sends the lead agent a turn listing the conflicted files', async () => {
    const { subs, merge } = services();
    await subWith(subs, 'header', { 'JobControl.razor': 'line 1\nheader version\nline 3\n' });
    const second = await subWith(subs, 'footer', { 'JobControl.razor': 'line 1\nfooter version\nline 3\n' });
    await merge.merge('71273');

    expect(await merge.handToLead('71273')).toEqual({ ok: true, data: { files: ['JobControl.razor'], held: false } });
    expect(sent).toEqual([{ ticketId: '71273', text: conflictHandOffMessage(second, '71273-cutover', ['JobControl.razor']) }]);
    expect(sent[0]?.text).toContain(`Merging ${second} into 71273-cutover stopped on conflicts in 1 file:\n- JobControl.razor`);
  });

  it('"I\'ll resolve it" opens the conflicted files in the editor', async () => {
    const { subs, merge } = services();
    await subWith(subs, 'header', { 'JobControl.razor': 'line 1\nheader version\nline 3\n' });
    await subWith(subs, 'footer', { 'JobControl.razor': 'line 1\nfooter version\nline 3\n' });
    await merge.merge('71273');

    expect(await merge.openConflictFiles('71273')).toEqual({ ok: true, data: { opened: [join(ticketPath, 'JobControl.razor')], fileCount: 1 } });
    expect(opened).toEqual([join(ticketPath, 'JobControl.razor')]);
  });

  it('refuses a dirty ticket worktree, and hand-off / open when nothing conflicts', async () => {
    const { subs, merge } = services();
    await subWith(subs, 'grid', { 'Grid.razor': '<grid />\n' });
    await repo.write('scratch.txt', 'wip\n', ticketPath);
    expect(await merge.merge('71273')).toMatchObject({ ok: false, code: 'GIT_DIRTY', details: { reason: 'worktree-dirty', files: ['scratch.txt'] } });
    expect(await merge.handToLead('71273')).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'no-conflict' } });
    expect(await merge.openConflictFiles('71273')).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'no-conflict' } });
    expect(await merge.merge('99999')).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found' } });
  });
});
