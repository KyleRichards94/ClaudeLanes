import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSettings, err, type Settings, type TicketAdoRef } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from '../git/git-error';
import type { GitRunner } from '../git/git-runner';
import { createGitService, type GitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createRepoSettings } from '../settings/repo-settings';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import {
  createTicketWorktreeService,
  titleFromDescription,
  type CreateTicketWorktreeInput,
  type TicketWorktreeService,
  type TicketWorktreeServiceOptions,
} from './ticket-worktree';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** 7 October 2026, 10:00 local time: no-ticket names start `nt-20261007-`. */
const NOW = new Date(2026, 9, 7, 10, 0).getTime();

function ado(workItemId: number): TicketAdoRef {
  return { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId };
}

function workItem(workItemId: number, title: string, extra: Partial<CreateTicketWorktreeInput> = {}): CreateTicketWorktreeInput {
  return { repo: repo.dir, subject: { kind: 'work-item', ado: ado(workItemId), title }, ...extra };
}

function noTicket(description: string, extra: Partial<CreateTicketWorktreeInput> = {}): CreateTicketWorktreeInput {
  return { repo: repo.dir, subject: { kind: 'no-ticket', description }, ...extra };
}

let repo: TempRepo;
let root: string;
let settingsDoc: Settings;
let tickets: TicketRecordStore;
let warnings: string[];

/** A service over the temp repo; `runner` wraps the real git to inject failures. */
function service(
  overrides: Partial<TicketWorktreeServiceOptions> & { runner?: (real: GitRunner) => GitRunner } = {},
): { worktrees: TicketWorktreeService; git: GitService } {
  const { runner, ...rest } = overrides;
  const git = createGitService({ runner: runner ? runner(repo.git) : repo.git });
  const worktrees = createTicketWorktreeService({
    git,
    settings: { get: () => structuredClone(settingsDoc) },
    tickets,
    now: () => NOW,
    log: { info: () => undefined, warn: (message) => warnings.push(message) },
    rollbackRetryDelaysMs: [0, 0],
    ...rest,
  });
  return { worktrees, git };
}

/** Wraps git so `worktree add` runs `instead` (which may call the real git). */
function onWorktreeAdd(instead: (args: readonly string[], options: Parameters<GitRunner>[1], real: GitRunner) => ReturnType<GitRunner>) {
  return (real: GitRunner): GitRunner =>
    (args, options) =>
      args[0] === 'worktree' && args[1] === 'add' ? instead(args, options, real) : real(args, options);
}

/** Everything a failed launch could leave behind: branches, worktrees (git's list and admin folders), the root and ticket records. */
async function snapshot() {
  const adminDir = join(repo.dir, '.git', 'worktrees');
  return {
    branches: await repo.exec(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
    worktrees: await repo.exec(['worktree', 'list', '--porcelain']),
    adminDirs: existsSync(adminDir) ? (await readdir(adminDir)).sort() : [],
    root: existsSync(root) ? (await readdir(root)).sort() : null,
    records: (await tickets.list()).map((record) => record.id),
  };
}

function worktreeOf(path: string) {
  return createGitService({ runner: repo.git }).worktrees(repo.dir).then((list) => list.find((entry) => entry.path === path));
}

beforeEach(async () => {
  repo = await createTempRepo();
  root = join(repo.root, '.agent-lanes');
  settingsDoc = defaultSettings();
  settingsDoc.repos = [createRepoSettings(repo.dir, { baseBranch: 'main' })];
  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  warnings = [];
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('creating a ticket worktree', () => {
  it('fetches the base, branches off origin/<base> in <root>/<id> and records the path and branch on the ticket', async () => {
    // Origin is one commit ahead of what this clone knows: the ticket must start from the fetched commit.
    const known = await repo.exec(['rev-parse', 'HEAD']);
    await repo.write('src/job-control.cs', 'class JobControl {}\n');
    const ahead = await repo.commit('Teammate change');
    await repo.exec(['push', '--quiet', 'origin', 'main']);
    await repo.exec(['reset', '--quiet', '--hard', known]);
    await repo.exec(['update-ref', 'refs/remotes/origin/main', known]);

    const { worktrees } = service();
    const result = await worktrees.create(workItem(71273, 'Cutover frmJobControl to Blazor', { skills: ['code-review'] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const path = join(root, '71273');
    expect(result.data.start).toEqual({ ref: 'origin/main', commit: ahead, fetchError: null });
    expect(result.data.record).toMatchObject({
      id: '71273',
      title: 'Cutover frmJobControl to Blazor',
      ado: ado(71273),
      repo: repo.dir,
      baseBranch: 'main',
      branch: '71273-cutover-frmjobcontrol-to',
      worktreePath: path,
      stage: 'queued',
      model: 'opus',
      effort: 'xhigh',
      skills: ['code-review'],
      sessionId: null,
    });
    // Recorded on disk, not only in memory.
    expect(await tickets.get('71273')).toEqual(result.data.record);

    expect(await worktreeOf(path)).toMatchObject({ branch: '71273-cutover-frmjobcontrol-to', head: ahead });
    expect(await readFile(join(path, 'src', 'job-control.cs'), 'utf8')).toBe('class JobControl {}\n');
    expect(await repo.exec(['status', '--porcelain'], path)).toBe('');
    // No upstream: the ticket branch is pushed under its own name later (a plain push would refuse `origin/main`).
    await expect(repo.exec(['config', '--get', 'branch.71273-cutover-frmjobcontrol-to.merge'])).rejects.toThrow();
    // The main checkout is untouched.
    expect(await repo.exec(['rev-parse', 'HEAD'])).toBe(known);
  });

  it('starts from the local base when origin cannot be reached', async () => {
    const local = await repo.commit('Local-only commit');
    await repo.exec(['remote', 'set-url', 'origin', join(repo.root, 'no-such-origin.git')]);

    const result = await service().worktrees.create(noTicket('Fix the login redirect'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.start).toMatchObject({ ref: 'main', commit: local, fetchError: expect.stringMatching(/^Could not fetch main from origin: /) });
    expect(result.data.record).toMatchObject({ id: 'nt-20261007-fix-the-login', branch: 'nt-20261007-fix-the-login', ado: null });
    expect(result.data.record.title).toBe('Fix the login redirect');
    expect(await worktreeOf(join(root, 'nt-20261007-fix-the-login'))).toMatchObject({ head: local });
    expect(warnings.join('\n')).toMatch(/Starting from the local main/);
  });

  it('starts from the local base when the repo has no origin remote', async () => {
    await repo.exec(['remote', 'remove', 'origin']);
    const result = await service().worktrees.create(workItem(71330, 'Asset register paging'));
    expect(result.ok && result.data.start).toMatchObject({ ref: 'main', fetchError: 'This repo has no origin remote.' });
  });

  it('starts from origin/<base> when the base branch exists only on origin', async () => {
    await repo.exec(['checkout', '--quiet', '-b', 'release/7.2']);
    const release = await repo.commit('Release work');
    await repo.exec(['push', '--quiet', 'origin', 'release/7.2']);
    await repo.exec(['checkout', '--quiet', 'main']);
    await repo.exec(['branch', '-D', 'release/7.2']);
    await repo.exec(['update-ref', '-d', 'refs/remotes/origin/release/7.2']);

    const result = await service().worktrees.create(workItem(71335, 'Hotfix', { baseBranch: 'release/7.2' }));
    expect(result.ok && result.data.start).toEqual({ ref: 'origin/release/7.2', commit: release, fetchError: null });
    expect(result.ok && result.data.record.baseBranch).toBe('release/7.2');
  });

  it('uses a branch name the user edited, and keeps the folder named after the ticket', async () => {
    const result = await service().worktrees.create(workItem(71341, 'Grid paging', { branch: 'feature/71341-grid' }));
    expect(result.ok && result.data.record).toMatchObject({ branch: 'feature/71341-grid', worktreePath: join(root, '71341') });
    expect(await worktreeOf(join(root, '71341'))).toMatchObject({ branch: 'feature/71341-grid' });
  });

  it('uses an empty folder already at the path', async () => {
    await mkdir(join(root, '71273'), { recursive: true });
    const result = await service().worktrees.create(workItem(71273, 'Cutover frmJobControl to Blazor'));
    expect(result.ok).toBe(true);
    expect(await worktreeOf(join(root, '71273'))).toBeDefined();
  });
});

describe('two tickets never share a worktree or a branch (R8)', () => {
  it('gives two tickets launched at the same time their own worktree and branch', async () => {
    const { worktrees } = service();
    const results = await Promise.all([
      worktrees.create(noTicket('Fix login')),
      worktrees.create(noTicket('Fix login')),
      worktrees.create(workItem(71273, 'Fix login')),
      worktrees.create(workItem(71330, 'Fix login')),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    const records = results.flatMap((result) => (result.ok ? [result.data.record] : []));
    expect(records.map((record) => record.branch).sort()).toEqual([
      '71273-fix-login',
      '71330-fix-login',
      'nt-20261007-fix-login',
      'nt-20261007-fix-login-2',
    ]);
    expect(new Set(records.map((record) => record.worktreePath)).size).toBe(4);

    const listed = await createGitService({ runner: repo.git }).worktrees(repo.dir);
    for (const record of records) {
      expect(listed.find((entry) => entry.path === record.worktreePath)?.branch).toBe(record.branch);
    }
    expect(new Set(listed.map((entry) => entry.branch)).size).toBe(listed.length);
  });

  it('refuses a second ticket for the same work item, even from another repo', async () => {
    const other = await createTempRepo();
    try {
      settingsDoc.repos.push(createRepoSettings(other.dir, { baseBranch: 'main', worktreeRoot: join(other.root, '.agent-lanes') }));
      const { worktrees } = service();
      const [first, second] = await Promise.all([
        worktrees.create(workItem(71273, 'Cutover frmJobControl to Blazor')),
        worktrees.create({ ...workItem(71273, 'Cutover frmJobControl to Blazor'), repo: other.dir }),
      ]);
      const outcomes = [first, second].map((result) => (result.ok ? 'ok' : (result.details as { reason: string }).reason)).sort();
      expect(outcomes).toEqual(['ok', 'ticket-exists']);

      const again = await worktrees.create(workItem(71273, 'Cutover frmJobControl to Blazor'));
      expect(again).toMatchObject({ ok: false, code: 'VALIDATION', message: 'Work item #71273 already has an agent ticket.' });
    } finally {
      await other.cleanup();
    }
  });

  it("refuses an edited branch name that is another ticket's branch, even after git deleted it", async () => {
    const { worktrees } = service();
    const first = await worktrees.create(workItem(71273, 'Cutover', { branch: 'shared-work' }));
    expect(first.ok).toBe(true);
    // The branch disappears from git (deleted by hand), but the first ticket still owns the name.
    await repo.exec(['worktree', 'remove', '--force', join(root, '71273')]);
    await repo.exec(['branch', '-D', 'shared-work']);

    const before = await snapshot();
    const second = await worktrees.create(workItem(71330, 'Asset register', { branch: 'shared-work' }));
    expect(second).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'branch-taken', conflictsWith: 'shared-work' } });
    expect(await snapshot()).toEqual(before);
  });

  it('refuses an edited branch name that exists locally or only on origin', async () => {
    await repo.exec(['branch', 'local-only']);
    await repo.exec(['push', '--quiet', 'origin', 'HEAD:refs/heads/remote-only']);
    const { worktrees } = service();
    const before = await snapshot();

    for (const branch of ['local-only', 'Remote-Only', 'main/sub']) {
      const result = await worktrees.create(workItem(71273, 'Cutover', { branch }));
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'branch-taken' } });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('avoids the name of a ticket whose branch was renamed, for no-ticket tickets', async () => {
    const { worktrees } = service();
    const first = await worktrees.create(noTicket('Fix login', { branch: 'my-login-fix' }));
    expect(first.ok && first.data.record.id).toBe('nt-20261007-fix-login');
    const second = await worktrees.create(noTicket('Fix login'));
    expect(second.ok && second.data.record).toMatchObject({ id: 'nt-20261007-fix-login-2', branch: 'nt-20261007-fix-login-2' });
  });
});

describe('refusals before anything is created', () => {
  async function expectRefusal(input: CreateTicketWorktreeInput, reason: string, worktrees = service().worktrees) {
    const before = await snapshot();
    const result = await worktrees.create(input);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason } });
    expect(await snapshot()).toEqual(before);
    return result;
  }

  it('refuses a path that holds files and leaves them alone', async () => {
    await mkdir(join(root, '71273'), { recursive: true });
    await writeFile(join(root, '71273', 'notes.txt'), 'mine');
    await expectRefusal(workItem(71273, 'Cutover'), 'path-occupied');
    expect(await readFile(join(root, '71273', 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('refuses a file at the path', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, '71273'), 'a file');
    await expectRefusal(workItem(71273, 'Cutover'), 'path-occupied');
  });

  it('refuses a path git still lists as a worktree whose folder is gone', async () => {
    await repo.exec(['worktree', 'add', '--quiet', '-b', 'old-71273', join(root, '71273'), 'main']);
    await rm(join(root, '71273'), { recursive: true, force: true });
    await expectRefusal(workItem(71273, 'Cutover'), 'worktree-registered');
  });

  it('refuses a base branch that exists nowhere', async () => {
    const result = await expectRefusal(workItem(71273, 'Cutover', { baseBranch: 'release/9.9' }), 'base-not-found');
    expect(result).toMatchObject({ message: 'The base branch "release/9.9" was not found locally or on origin.' });
  });

  it('refuses an invalid base branch name, an invalid edited branch name and an unregistered repo', async () => {
    await expectRefusal(workItem(71273, 'Cutover', { baseBranch: '-main' }), 'invalid-base-branch');
    await expectRefusal(workItem(71273, 'Cutover', { branch: 'has space' }), 'invalid-branch');
    await expectRefusal(workItem(71273, 'Cutover', { branch: 'a..b' }), 'invalid-branch');
    await expectRefusal({ ...workItem(71273, 'Cutover'), repo: join(repo.root, 'elsewhere') }, 'repo-not-registered');
    await expectRefusal({ ...workItem(71273, 'Cutover'), subject: { kind: 'work-item', ado: ado(0), title: 'x' } }, 'invalid-work-item');
  });

  it('refuses a worktree root that is not absolute', async () => {
    settingsDoc.repos = [createRepoSettings(repo.dir, { worktreeRoot: '.agent-lanes' })];
    await expectRefusal(workItem(71273, 'Cutover'), 'invalid-worktree-root');
  });
});

describe('failure leaves no half-created worktree or branch', () => {
  it('rolls back when git fails after checking out (a failing post-checkout hook)', async () => {
    const hooks = join(repo.root, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\necho "post-checkout hook failed" >&2\nexit 1\n');
    await chmod(join(hooks, 'post-checkout'), 0o755);
    await repo.exec(['config', 'core.hooksPath', hooks]);
    const before = await snapshot();

    const result = await service().worktrees.create(workItem(71273, 'Cutover frmJobControl to Blazor'));

    expect(result).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      details: { reason: 'git-failed', gitCode: 'COMMAND_FAILED', rollback: { complete: true, leftovers: [] } },
    });
    expect(await snapshot()).toEqual(before);
    expect(existsSync(root)).toBe(false);
  });

  it('rolls back when the ticket record cannot be written', async () => {
    const before = await snapshot();
    const failingTickets: TicketWorktreeServiceOptions['tickets'] = {
      get: (id) => tickets.get(id),
      list: (filter) => tickets.list(filter),
      create: async () => err('INTERNAL', 'Could not write 71273.json (ENOSPC)'),
    };

    const result = await service({ tickets: failingTickets }).worktrees.create(workItem(71273, 'Cutover frmJobControl to Blazor'));

    expect(result).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      message: 'The ticket record could not be saved: Could not write 71273.json (ENOSPC)',
      details: { reason: 'record-failed', rollback: { complete: true } },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back when git is stopped after creating the branch (timeout)', async () => {
    const before = await snapshot();
    const runner = onWorktreeAdd(async (args, options, real) => {
      // Git makes the branch first; then it is killed before it touches the folder.
      const branch = args[args.indexOf('-b') + 1] as string;
      await real(['branch', branch, args.at(-1) as string], options);
      throw new GitError('TIMEOUT', 'git worktree add did not finish within 60000 ms and was stopped');
    });

    const result = await service({ runner }).worktrees.create(workItem(71273, 'Cutover'));

    expect(result).toMatchObject({ ok: false, details: { reason: 'git-failed', gitCode: 'TIMEOUT', rollback: { complete: true } } });
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back a worktree folder git was killed in before it could clean up (Windows does not run its handlers)', async () => {
    const before = await snapshot();
    const runner = onWorktreeAdd(async (args, options, real) => {
      await real(args, options);
      // What a hard kill can leave: the folder and its .git pointer, but git's own record already gone.
      const path = args.at(-2) as string;
      await rm(join(repo.dir, '.git', 'worktrees', '71273'), { recursive: true, force: true });
      expect(existsSync(join(path, '.git'))).toBe(true);
      throw new GitError('COMMAND_FAILED', 'git worktree add was killed by SIGKILL');
    });

    const result = await service({ runner }).worktrees.create(workItem(71273, 'Cutover'));

    expect(result).toMatchObject({ ok: false, details: { reason: 'git-failed', rollback: { complete: true } } });
    expect(await snapshot()).toEqual(before);
  });

  it('retries removing a worktree Windows briefly locks, and puts back the empty folder that was there', async () => {
    await mkdir(join(root, '71273'), { recursive: true });
    const before = await snapshot();
    let removals = 0;
    const runner = (real: GitRunner): GitRunner => async (args, options) => {
      if (args[0] === 'worktree' && args[1] === 'remove' && removals++ === 0) {
        throw new GitError('COMMAND_FAILED', 'git worktree remove failed (exit 128): fatal: Permission denied');
      }
      return real(args, options);
    };
    const failingTickets: TicketWorktreeServiceOptions['tickets'] = { ...tickets, create: async () => err('INTERNAL', 'disk full') };

    const result = await service({ runner, tickets: failingTickets }).worktrees.create(workItem(71273, 'Cutover'));

    expect(result).toMatchObject({ ok: false, details: { rollback: { complete: true } } });
    expect(removals).toBe(2);
    expect(await snapshot()).toEqual(before);
    expect(await readdir(join(root, '71273'))).toEqual([]);
  });

  it('reports what it could not remove instead of claiming a clean rollback', async () => {
    const runner = (real: GitRunner): GitRunner => async (args, options) => {
      if (args[0] === 'worktree' && args[1] === 'remove') throw new GitError('COMMAND_FAILED', 'Permission denied');
      return real(args, options);
    };
    const failingTickets: TicketWorktreeServiceOptions['tickets'] = { ...tickets, create: async () => err('INTERNAL', 'disk full') };
    const result = await service({ runner, tickets: failingTickets }).worktrees.create(workItem(71273, 'Cutover'));

    // The folder could be deleted (it is ours), but git's record of the worktree could not, so the
    // branch it has checked out is kept too.
    expect(result).toMatchObject({ ok: false, details: { rollback: { complete: false } } });
    const { leftovers } = (result as { details: { rollback: { leftovers: string[] } } }).details.rollback;
    expect(leftovers).toEqual([`worktree ${join(root, '71273')}`, 'branch 71273-cutover']);
    expect(warnings.join('\n')).toMatch(/rollback left worktree/);
  });

  it('rolls back when the launch is cancelled after the worktree was added', async () => {
    const controller = new AbortController();
    const before = await snapshot();
    const runner = onWorktreeAdd(async (args, options, real) => {
      const output = await real(args, { ...options, signal: undefined });
      controller.abort();
      return output;
    });

    const result = await service({ runner }).worktrees.create(workItem(71273, 'Cutover', { signal: controller.signal }));

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { reason: 'aborted', rollback: { complete: true } } });
    expect(await snapshot()).toEqual(before);
  });

  it('frees the ticket id after a failure, so the launch can be retried', async () => {
    let fail = true;
    const runner = onWorktreeAdd(async (args, options, real) => {
      if (fail) throw new GitError('COMMAND_FAILED', 'boom');
      return real(args, options);
    });
    const { worktrees } = service({ runner });
    expect((await worktrees.create(workItem(71273, 'Cutover'))).ok).toBe(false);
    fail = false;
    const retry = await worktrees.create(workItem(71273, 'Cutover'));
    expect(retry.ok && retry.data.record.branch).toBe('71273-cutover');
  });
});

describe('titleFromDescription', () => {
  it.each([
    ['Fix the login redirect', 'Fix the login redirect'],
    ['\n\n  First   line  \nsecond line', 'First line'],
    ['', ''],
    ['   \n  ', ''],
    [`${'word '.repeat(40)}end`, `${'word '.repeat(23).trimEnd()}…`],
    ['x'.repeat(200), `${'x'.repeat(119)}…`],
  ])('%j → %j', (description, title) => {
    expect(titleFromDescription(description)).toBe(title);
  });
});
