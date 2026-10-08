import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Result } from '@agent-lanes/contracts';
import { fakeClaudeEnv, writeFakeClaudeState } from './support/fake-claude-code';

/**
 * Skill discovery (AL-114) in the real app: `skills:list` starts the stand-in `claude` in the repo's
 * main checkout, reads what `supportedCommands()` lists (the repo's own skill, the user's skills,
 * built-ins), and returns the skills only. Nothing contacts Anthropic.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let root: string;
let repo: string;
let log: string;
let app: ElectronApplication | undefined;
let page: Page;

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-skills-'));
  const userDataDir = join(root, 'user-data');
  repo = join(root, 'onsite-companion');
  log = join(root, 'claude-log.jsonl');
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(repo);
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      version: 2,
      repos: [{ path: repo, name: 'onsite-companion', baseBranch: 'main', worktreeRoot: join(root, '.agent-lanes'), buildCommand: null, runCommand: null, maxConcurrentAgents: 3 }],
    }),
  );
  const stateFile = join(root, 'claude-state.json');
  writeFakeClaudeState(stateFile, {
    login: null,
    log,
    commands: [
      { name: 'compact', description: 'Clear the conversation but keep a summary', argumentHint: '', builtin: true },
      { name: 'osc-blazor-cutover-invoke', description: "The repo's own skill", argumentHint: '<form>' },
      { name: 'code-review', description: "One of the user's skills", argumentHint: '' },
    ],
  });
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, CLAUDE_CONFIG_DIR: join(root, 'claude-config'), ...fakeClaudeEnv(stateFile) },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

test("skills:list returns the repo's and the user's skills from a session in the repo, without built-ins (AL-114)", async () => {
  const listed = await invoke<{ repo: string; skills: { name: string }[] }>('skills:list', { repo });
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  expect(listed.data.skills.map((skill) => skill.name)).toEqual(['code-review', 'osc-blazor-cutover-invoke']);

  // The stand-in ran in the repo's main checkout and was closed again.
  await expect.poll(() => existsSync(log)).toBe(true);
  const starts = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { cwd: string; prompts: string[] });
  expect(starts).toHaveLength(1);
  expect(starts[0]?.cwd.toLowerCase()).toBe(repo.toLowerCase());
  expect(starts[0]?.prompts).toEqual([]);

  // Cached until a refresh asks again.
  await invoke('skills:list', { repo });
  await invoke('skills:list', { repo, refresh: true });
  await expect.poll(() => readFileSync(log, 'utf8').trim().split('\n').length).toBe(2);

  expect(await invoke('skills:list', { repo: join(root, 'not-registered') })).toMatchObject({ ok: false, code: 'VALIDATION' });
});
