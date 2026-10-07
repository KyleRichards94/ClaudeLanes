import { join } from 'node:path';
import type { Lane } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from '../git/git-error';
import type { GitRunner } from '../git/git-runner';
import { createGitService } from '../git/git-service';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets/record-store';
import { newTicketInput } from '../tickets/testing';
import { createMergeToMainService, qaPassed } from './merge-to-main';

// Every git call is a process spawn (slow on Windows with antivirus), as in src/main/git.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;
let tickets: TicketRecordStore;
let ticketPath: string;
const BRANCH = '71273-cutover-job-control';

function service(runner?: (real: GitRunner) => GitRunner) {
  return createMergeToMainService({
    git: createGitService({ runner: runner ? runner(repo.git) : repo.git }),
    tickets,
    log: { info: () => undefined, warn: () => undefined },
  });
}

async function moveTo(...stages: Lane[]) {
  for (const stage of stages) await tickets.update('71273', (record) => ({ ...record, stage }));
}

const originMain = () => repo.exec(['rev-parse', 'refs/heads/main'], repo.origin);

beforeEach(async () => {
  repo = await createTempRepo();
  ticketPath = join(repo.root, '.agent-lanes', '71273');
  await repo.exec(['worktree', 'add', '--quiet', '-b', BRANCH, ticketPath, 'main']);
  await repo.write('src/JobControl.razor', '<h1>Jobs</h1>\n', ticketPath);
  await repo.commit('Cut over JobControl', ticketPath);
  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), warn: () => undefined });
  const created = await tickets.create(newTicketInput(repo.root, { repo: repo.dir, branch: BRANCH, worktreePath: ticketPath }));
  if (!created.ok) throw new Error(created.message);
  await moveTo('planning', 'implementing', 'code-review', 'qa', 'create-pr');
});

afterEach(async () => {
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('merge worktree → main', () => {
  it('merges the ticket branch into main in the main checkout with --no-ff, pushes it and moves the card to Done', async () => {
    const before = await repo.exec(['rev-parse', 'HEAD']);
    const ticketHead = await repo.exec(['rev-parse', BRANCH]);

    const result = await service().merge('71273');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const merged = await repo.exec(['rev-parse', 'HEAD']);
    expect(result.data).toMatchObject({ target: 'main', mergeCommit: merged, pushed: true });
    expect(await repo.exec(['rev-list', '--parents', '-n', '1', 'HEAD'])).toBe(`${merged} ${before} ${ticketHead}`);
    expect(await repo.exec(['log', '-1', '--format=%B'])).toContain(`Merge branch '${BRANCH}' into main`);
    expect(await originMain()).toBe(merged);
    // The main checkout's files follow the merge: nothing shows as changed.
    expect(await repo.exec(['status', '--porcelain'])).toBe('');
    expect(result.data.record.stage).toBe('done');
    expect(result.data.mergedAt).toBe(result.data.record.stageHistory.at(-1)?.at);
    expect((await tickets.get('71273'))?.stage).toBe('done');
  });

  it.each([
    ['an unstaged edit', () => repo.write('src/JobControl.razor', '<h1>Changed</h1>\n', ticketPath)],
    ['a staged file', async () => {
      await repo.write('src/New.razor', 'new\n', ticketPath);
      await repo.exec(['add', '.'], ticketPath);
    }],
    ['an untracked file', () => repo.write('notes.txt', 'wip\n', ticketPath)],
  ])('cannot merge with uncommitted changes (%s): GIT_DIRTY and nothing changes', async (_, makeDirty) => {
    await makeDirty();
    const before = await repo.exec(['rev-parse', 'HEAD']);

    const result = await service().merge('71273', { acceptQaWarning: true });

    expect(result).toMatchObject({ ok: false, code: 'GIT_DIRTY', details: { reason: 'worktree-dirty', fileCount: 1 } });
    expect(await repo.exec(['rev-parse', 'HEAD'])).toBe(before);
    expect(await originMain()).toBe(before);
    expect((await tickets.get('71273'))?.stage).toBe('create-pr');
  });

  it('warns when QA has not passed, and merges once the user accepts the warning', async () => {
    await moveTo('implementing');

    const warned = await service().merge('71273');
    expect(warned).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'qa-not-passed' } });

    const merged = await service().merge('71273', { acceptQaWarning: true });
    expect(merged).toMatchObject({ ok: true, data: { record: { stage: 'done' } } });
  });

  it('stops on a conflict without changing the main checkout, and lists the files', async () => {
    await repo.write('src/JobControl.razor', '<h1>Teammate</h1>\n');
    const before = await repo.commit('Teammate edit');
    await repo.exec(['push', '--quiet', 'origin', 'main']);

    const result = await service().merge('71273');

    expect(result).toMatchObject({ ok: false, code: 'MERGE_CONFLICT', details: { reason: 'conflict', files: ['src/JobControl.razor'] } });
    expect(await repo.exec(['rev-parse', 'HEAD'])).toBe(before);
    expect(await repo.exec(['status', '--porcelain'])).toBe('');
    await expect(repo.exec(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])).rejects.toThrow();
  });

  it('refuses when the main checkout has uncommitted changes to tracked files', async () => {
    await repo.write('README.md', 'local edit\n');

    const result = await service().merge('71273');

    expect(result).toMatchObject({ ok: false, code: 'GIT_DIRTY', details: { reason: 'base-checkout-dirty', worktreePath: repo.dir } });
  });

  it('merges without touching any checkout when the base branch is not checked out', async () => {
    await repo.exec(['switch', '--quiet', '-c', 'side']);
    const mainBefore = await repo.exec(['rev-parse', 'main']);

    const result = await service().merge('71273');

    expect(result.ok).toBe(true);
    const merged = await repo.exec(['rev-parse', 'main']);
    expect(await repo.exec(['rev-list', '--parents', '-n', '1', 'main'])).toBe(`${merged} ${mainBefore} ${await repo.exec(['rev-parse', BRANCH])}`);
    expect(await repo.exec(['ls-tree', '--name-only', '-r', 'main'])).toContain('src/JobControl.razor');
    expect(await originMain()).toBe(merged);
    expect(await repo.exec(['branch', '--show-current'])).toBe('side');
  });

  it('reports a conflict found without a checkout the same way', async () => {
    await repo.write('src/JobControl.razor', '<h1>Teammate</h1>\n');
    await repo.commit('Teammate edit');
    await repo.exec(['switch', '--quiet', '-c', 'side']);

    const result = await service().merge('71273');

    expect(result).toMatchObject({ ok: false, code: 'MERGE_CONFLICT', details: { files: ['src/JobControl.razor'] } });
  });

  it("fast-forwards the local base to origin's first, so the push is not rejected", async () => {
    // A teammate pushed to main; this clone hasn't pulled.
    const known = await repo.exec(['rev-parse', 'HEAD']);
    await repo.write('other.txt', 'teammate\n');
    const teammate = await repo.commit('Teammate change');
    await repo.exec(['push', '--quiet', 'origin', 'main']);
    await repo.exec(['reset', '--quiet', '--hard', known]);

    const result = await service().merge('71273');

    expect(result.ok).toBe(true);
    expect(await repo.exec(['rev-parse', 'HEAD^1'])).toBe(teammate);
    expect(await originMain()).toBe(await repo.exec(['rev-parse', 'HEAD']));
  });

  it('refuses when the local base and origin have both moved on', async () => {
    const known = await repo.exec(['rev-parse', 'HEAD']);
    await repo.write('other.txt', 'teammate\n');
    await repo.commit('Teammate change');
    await repo.exec(['push', '--quiet', 'origin', 'main']);
    await repo.exec(['reset', '--quiet', '--hard', known]);
    await repo.write('mine.txt', 'local\n');
    await repo.commit('Local change');

    const result = await service().merge('71273');

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'base-diverged' } });
  });

  it('keeps the local merge when the push fails, and a second try only pushes', async () => {
    let failPush = true;
    const flaky = (real: GitRunner): GitRunner => (args, options) => {
      if (args[0] === 'push' && failPush) {
        failPush = false;
        return Promise.reject(new GitError('COMMAND_FAILED', 'git push failed', { exitCode: 1, stderr: 'remote rejected' }));
      }
      return real(args, options);
    };
    const merge = service(flaky);

    const first = await merge.merge('71273');
    expect(first).toMatchObject({ ok: false, code: 'INTERNAL', details: { reason: 'push-failed' } });
    const merged = await repo.exec(['rev-parse', 'HEAD']);
    expect((await tickets.get('71273'))?.stage).toBe('create-pr');

    const second = await merge.merge('71273');
    expect(second).toMatchObject({ ok: true, data: { mergeCommit: null, pushed: true } });
    expect(await repo.exec(['rev-parse', 'HEAD'])).toBe(merged);
    expect(await originMain()).toBe(merged);
  });

  it('previews source, target, QA and the worktree for the confirm modal', async () => {
    await repo.write('wip.txt', 'wip\n', ticketPath);

    const result = await service().preview('71273');

    expect(result).toEqual({
      ok: true,
      data: {
        ticketId: '71273',
        source: BRANCH,
        target: 'main',
        repo: repo.dir,
        qaPassed: true,
        worktree: { worktreePath: ticketPath, present: true, dirty: true, changedFiles: 1, conflicted: false },
        ahead: 1,
        alreadyMerged: false,
      },
    });
  });

  it('refuses an unknown ticket', async () => {
    expect(await service().merge('99999')).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found' } });
  });
});

describe('qaPassed', () => {
  it('is true only after QA, in Create PR or Done', async () => {
    const record = await tickets.get('71273');
    if (!record) throw new Error('no record');
    expect(qaPassed(record)).toBe(true);
    expect(qaPassed({ ...record, stage: 'qa' })).toBe(false);
    expect(qaPassed({ ...record, stage: 'create-pr', stageHistory: [{ stage: 'create-pr', at: 1 }] })).toBe(false);
    // QA sent it back to Implementing; it has not been through QA again.
    const sentBack = [...record.stageHistory, { stage: 'implementing' as const, at: 9 }, { stage: 'create-pr' as const, at: 10 }];
    expect(qaPassed({ ...record, stage: 'create-pr', stageHistory: sentBack })).toBe(false);
  });
});
