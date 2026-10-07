import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTicketRecordStore } from './record-store';
import { createTempDir, listTree, newTicketInput } from './testing';

/**
 * Acceptance criterion: nothing is written inside a worktree, so the store can never make one dirty
 * (GIT_DIRTY, AL-087). Uses a real repo with a ticket worktree and a sub-branch worktree.
 */

let dir: string;
let remove: () => Promise<void>;
let gitEnv: NodeJS.ProcessEnv;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Agent Lanes Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: gitEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** The working tree's files, without git's own folder. */
async function workingFiles(checkout: string): Promise<string[]> {
  return (await listTree(checkout)).filter((name) => name !== '.git' && !name.startsWith('.git/'));
}

/** Untracked and ignored files included: a clean worktree prints nothing. */
function status(cwd: string): string {
  return git(cwd, 'status', '--porcelain=v1', '--ignored', '--untracked-files=all');
}

beforeEach(async () => {
  ({ dir, remove } = await createTempDir('agent-lanes-worktree-'));
  // Keep the user's git config (hooks, templates, signing) out of the test repo.
  const emptyConfig = join(dir, 'empty.gitconfig');
  await writeFile(emptyConfig, '');
  gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };
});

afterEach(async () => {
  await remove();
});

async function setUpRepo() {
  const ticket = newTicketInput(dir);
  await mkdir(ticket.repo, { recursive: true });
  git(ticket.repo, 'init', '--initial-branch=main');
  await writeFile(join(ticket.repo, 'README.md'), '# OnSite Companion\n');
  await writeFile(join(ticket.repo, '.gitignore'), 'bin/\n');
  git(ticket.repo, 'add', '.');
  git(ticket.repo, 'commit', '-m', 'Initial commit');
  git(ticket.repo, 'worktree', 'add', '-b', ticket.branch, ticket.worktreePath, 'main');
  const subWorktree = join(dir, '.agent-lanes', '71273--grid');
  git(ticket.repo, 'worktree', 'add', '-b', 'sub/71273-grid', subWorktree, ticket.branch);
  return { ticket, subWorktree, checkouts: [ticket.repo, ticket.worktreePath, subWorktree] };
}

describe('ticket records and worktrees', () => {
  it('never writes inside the repo, the ticket worktree or a sub-branch worktree', async () => {
    const { ticket, subWorktree, checkouts } = await setUpRepo();
    const before = await Promise.all(checkouts.map((checkout) => workingFiles(checkout)));
    for (const checkout of checkouts) expect(status(checkout), checkout).toBe('');

    const root = join(dir, 'userData', 'tickets');
    const store = createTicketRecordStore({ rootDir: root, debounceMs: 5, maxWaitMs: 20 });
    expect((await store.create(ticket)).ok).toBe(true);
    for (const stage of ['planning', 'implementing', 'code-review', 'implementing', 'qa'] as const) {
      const result = await store.update(ticket.id, (record) => ({
        ...record,
        stage,
        sessionId: 'cc-71273',
        subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: subWorktree, createdAt: record.createdAt, mergedAt: null }],
        lastBuild: { outcome: 'succeeded', startedAt: record.createdAt, finishedAt: record.createdAt + 1, errors: 0, warnings: 2 },
      }));
      expect(result.ok).toBe(true);
    }
    expect(await store.flush()).toEqual({ ok: true, data: undefined });
    await store.dispose();

    // A restart reads the record and writes again.
    const restarted = createTicketRecordStore({ rootDir: root });
    expect((await restarted.get(ticket.id))?.stage).toBe('qa');
    await restarted.update(ticket.id, (record) => ({ ...record, stage: 'create-pr' }));
    await restarted.dispose();

    for (const checkout of checkouts) expect(status(checkout), checkout).toBe('');
    expect(await Promise.all(checkouts.map((checkout) => workingFiles(checkout)))).toEqual(before);
    expect((await listTree(root)).filter((name) => name.endsWith('.json'))).toHaveLength(1);
  });

  it('refuses to keep records in a profile folder inside the worktree, which stays clean', async () => {
    const { ticket } = await setUpRepo();
    const store = createTicketRecordStore({ rootDir: join(ticket.worktreePath, 'profile', 'tickets'), warn: () => undefined });

    expect(await store.create(ticket)).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(status(ticket.worktreePath)).toBe('');
    expect(status(ticket.repo)).toBe('');
  });
});
