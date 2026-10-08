import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService, type GitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import { newTicketInput } from '../tickets/testing';
import { createBranchStatusService } from './branch-status';
import { createSubWorktreeService, isReadOnlyAgentType, subWorktreeHooks, type SubWorktreeService } from './sub-worktree';

// Every git call is a process spawn (slow on Windows with antivirus), as in the other real-git tests.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

let repo: TempRepo;
let git: GitService;
let tickets: TicketRecordStore;
let ticketPath: string;
let service: SubWorktreeService;

beforeEach(async () => {
  repo = await createTempRepo();
  git = createGitService({ runner: repo.git });
  ticketPath = join(repo.root, '.agent-lanes', '71273');
  await repo.exec(['worktree', 'add', '--quiet', '-b', '71273-cutover', ticketPath, 'main']);
  await repo.write('shared.txt', 'ticket\n', ticketPath);
  await repo.commit('Ticket work', ticketPath);
  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  const created = await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: '71273-cutover', worktreePath: ticketPath }));
  if (!created.ok) throw new Error(created.message);
  let clock = 1_000;
  service = createSubWorktreeService({ git, tickets, now: () => clock++, rollbackRetryDelaysMs: [0], log: { info: () => undefined, warn: () => undefined } });
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

/** Calls a session's WorktreeCreate hook as Claude Code would. */
async function hookCreate(ticketId: string, name: string, agentType?: string) {
  const hooks = subWorktreeHooks(service, ticketId);
  const callback = hooks.WorktreeCreate?.[0]?.hooks[0] as HookCallback;
  const input = {
    hook_event_name: 'WorktreeCreate',
    name,
    session_id: 's',
    transcript_path: 't',
    cwd: ticketPath,
    ...(agentType ? { agent_type: agentType } : {}),
  } as HookInput;
  return callback(input, undefined, { signal: new AbortController().signal });
}

describe('sub-agent worktrees (AL-084)', () => {
  it('creates sub/<ticket>-<name> off the ticket branch at <root>/<ticket>--<name> and records it', async () => {
    const output = await hookCreate('71273', 'razor-writer');
    const path = join(repo.root, '.agent-lanes', '71273--razor-writer');
    expect(output).toEqual({ hookSpecificOutput: { hookEventName: 'WorktreeCreate', worktreePath: path } });

    expect(await repo.exec(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('sub/71273-razor-writer');
    expect(await repo.exec(['rev-parse', 'HEAD'], path)).toBe(await repo.exec(['rev-parse', '71273-cutover']));
    expect(await readFile(join(path, 'shared.txt'), 'utf8')).toBe('ticket\n');

    const record = await tickets.get('71273');
    expect(record?.subBranches).toEqual([{ name: 'razor-writer', branch: 'sub/71273-razor-writer', worktreePath: path, createdAt: 1_000, mergedAt: null }]);
  });

  it('two writer sub-agents edit in parallel without touching each other’s files', async () => {
    const [grid, tests] = await Promise.all([service.create('71273', 'grid'), service.create('71273', 'tests')]);
    if (!grid.ok || !tests.ok) throw new Error('could not create the sub-worktrees');
    expect(grid.data.worktreePath).not.toBe(tests.data.worktreePath);
    expect(new Set([grid.data.branch, tests.data.branch])).toEqual(new Set(['sub/71273-grid', 'sub/71273-tests']));

    // Both edit the same file at once, each in its own worktree.
    await Promise.all([
      repo.write('shared.txt', 'grid\n', grid.data.worktreePath).then(() => repo.write('Grid.razor', '<grid />\n', grid.data.worktreePath)),
      repo.write('shared.txt', 'tests\n', tests.data.worktreePath).then(() => repo.write('GridTests.cs', '// tests\n', tests.data.worktreePath)),
    ]);
    await repo.commit('Grid', grid.data.worktreePath);
    await repo.commit('Tests', tests.data.worktreePath);

    expect(await readFile(join(grid.data.worktreePath, 'shared.txt'), 'utf8')).toBe('grid\n');
    expect(await readFile(join(tests.data.worktreePath, 'shared.txt'), 'utf8')).toBe('tests\n');
    expect(existsSync(join(grid.data.worktreePath, 'GridTests.cs'))).toBe(false);
    expect(existsSync(join(tests.data.worktreePath, 'Grid.razor'))).toBe(false);
    // The ticket worktree is untouched and clean.
    expect(await readFile(join(ticketPath, 'shared.txt'), 'utf8')).toBe('ticket\n');
    expect(await repo.exec(['status', '--porcelain'], ticketPath)).toBe('');

    // Both are recorded and show in branch status (the Sub-branches panel) with their ahead counts.
    const status = await createBranchStatusService({ git, tickets }).status('71273');
    expect(status.ok && status.data.subBranches.map((sub) => [sub.branch, sub.ahead, sub.ready])).toEqual(
      expect.arrayContaining([
        ['sub/71273-grid', 1, true],
        ['sub/71273-tests', 1, true],
      ]),
    );
  });

  it('gives the same worktree when a resumed session asks for a name again', async () => {
    const first = await service.create('71273', 'grid');
    const again = await service.create('71273', 'grid');
    expect(again).toEqual({ ok: true, data: { ...(first.ok ? first.data : {}), created: false } });
    expect((await tickets.get('71273'))?.subBranches).toHaveLength(1);
  });

  it('read-only sub-agents share the ticket worktree and get no branch', async () => {
    expect(await hookCreate('71273', 'explore', 'Explore')).toEqual({ hookSpecificOutput: { hookEventName: 'WorktreeCreate', worktreePath: ticketPath } });
    expect(await service.create('71273', 'review', { agentType: 'code-reviewer' })).toMatchObject({ ok: true, data: { shared: true, worktreePath: ticketPath } });
    expect((await tickets.get('71273'))?.subBranches).toEqual([]);
    expect(await repo.exec(['branch', '--list', 'sub/*'])).toBe('');
  });

  it('picks a free name when a branch with that name exists', async () => {
    await repo.exec(['branch', 'sub/71273-grid', 'main']);
    const created = await service.create('71273', 'grid');
    expect(created).toMatchObject({ ok: true, data: { branch: 'sub/71273-grid-2', worktreePath: join(repo.root, '.agent-lanes', '71273--grid-2') } });
  });

  it('refuses an occupied folder and blocks the spawn, leaving no branch behind', async () => {
    await repo.write('keep.txt', 'mine\n', join(repo.root, '.agent-lanes', '71273--grid'));
    expect(await hookCreate('71273', 'grid')).toMatchObject({ decision: 'block' });
    expect(await repo.exec(['branch', '--list', 'sub/*'])).toBe('');
    expect((await tickets.get('71273'))?.subBranches).toEqual([]);
  });

  it('WorktreeRemove keeps the worktree (only Archive removes worktrees)', async () => {
    const created = await service.create('71273', 'grid');
    if (!created.ok) throw new Error(created.message);
    const remove = subWorktreeHooks(service, '71273').WorktreeRemove?.[0]?.hooks[0] as HookCallback;
    expect(
      await remove({ hook_event_name: 'WorktreeRemove', worktree_path: created.data.worktreePath, session_id: 's', transcript_path: 't', cwd: ticketPath } as HookInput, undefined, {
        signal: new AbortController().signal,
      }),
    ).toEqual({});
    expect(existsSync(created.data.worktreePath)).toBe(true);
  });

  it('refuses an unknown ticket', async () => {
    expect(await service.create('99999', 'grid')).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});

describe('read-only agent types', () => {
  it.each([
    ['Explore', true],
    ['explore', true],
    ['code-reviewer', true],
    ['security-reviewer', true],
    ['Plan', true],
    ['general-purpose', false],
    ['razor-writer', false],
    [undefined, false],
  ])('%s → %s', (agentType, readOnly) => {
    expect(isReadOnlyAgentType(agentType)).toBe(readOnly);
  });
});
