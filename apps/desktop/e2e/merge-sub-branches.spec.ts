import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { MergeSubBranchesResult, Result } from '@agent-lanes/contracts';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-086 in the real app: `git:mergeSubBranches` merges a ticket's ready sub-branches into its branch
 * in a real (temporary) repo, then stops at a conflict with MERGE_CONFLICT and its files; "I'll resolve
 * it" is not pressed here because it would open the user's editor.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let root: string;
let app: ElectronApplication | undefined;
let page: Page;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Agent Lanes Test', '-c', 'user.email=test@agent-lanes.invalid', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function commitFile(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-merge-subs-'));
  const repo = join(root, 'onsite-companion');
  const worktrees = join(root, '.agent-lanes');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commitFile(repo, 'JobControl.razor', 'line 1\nline 2\nline 3\n', 'Initial');
  const ticketPath = join(worktrees, '71273');
  git(repo, 'worktree', 'add', '-q', '-b', '71273-cutover-job-control', ticketPath, 'main');

  const subs = [
    { name: 'grid', file: 'Grid.razor', content: '<grid />\n' },
    { name: 'header', file: 'JobControl.razor', content: 'line 1\nheader\nline 3\n' },
    { name: 'footer', file: 'JobControl.razor', content: 'line 1\nfooter\nline 3\n' },
  ].map((sub, index) => {
    const path = join(worktrees, `71273--${sub.name}`);
    const branch = `sub/71273-${sub.name}`;
    git(repo, 'worktree', 'add', '-q', '-b', branch, path, '71273-cutover-job-control');
    commitFile(path, sub.file, sub.content, `${sub.name} work`);
    return { name: sub.name, branch, worktreePath: path, createdAt: 1_000 + index, mergedAt: null };
  });

  const userDataDir = join(root, 'user-data');
  seedTicketRecords(userDataDir, [e2eTicketRecord({ repo, worktreePath: ticketPath, subBranches: subs, sessionId: null })]);
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, CLAUDE_CONFIG_DIR: join(root, 'claude-config') },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

test('merges ready sub-branches in order and stops at the first conflict (AL-086)', async () => {
  const result = await invoke<MergeSubBranchesResult>('git:mergeSubBranches', { ticketId: '71273' });
  expect(result).toMatchObject({
    ok: false,
    code: 'MERGE_CONFLICT',
    details: {
      reason: 'conflict',
      branch: 'sub/71273-footer',
      files: ['JobControl.razor'],
      merged: [{ branch: 'sub/71273-grid' }, { branch: 'sub/71273-header' }],
    },
  });

  const status = await invoke<{ subBranches: Array<{ branch: string; ahead: number | null; mergedAt: number | null }> }>('branches:status', { ticketId: '71273' });
  expect(status.ok && status.data.subBranches.map((sub) => [sub.branch, sub.ahead, sub.mergedAt !== null])).toEqual([
    ['sub/71273-grid', 0, true],
    ['sub/71273-header', 0, true],
    ['sub/71273-footer', 1, false],
  ]);

  // While the conflict is open, merging again is refused and nothing else is merged.
  expect(await invoke('git:mergeSubBranches', { ticketId: '71273' })).toMatchObject({ ok: false, code: 'MERGE_CONFLICT', details: { reason: 'merge-in-progress' } });
  // No session runs, so the hand-off to the lead agent says why it could not be sent.
  expect(await invoke('git:handConflictToLead', { ticketId: '71273' })).toMatchObject({ ok: false, code: 'VALIDATION' });
});
