import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Result, Settings } from '@agent-lanes/contracts';

/** Settings store (AL-041) against the real app, electron-store and a throwaway profile. */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

interface Running {
  app: ElectronApplication;
  page: Page;
}

let userDataDir: string;
let running: Running | undefined;

async function launch(): Promise<Page> {
  const app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  // The board renders only after the UI prefs gate has loaded the settings.
  await expect(page.getByText('Agent board')).toBeVisible();
  running = { app, page };
  return page;
}

async function close(): Promise<void> {
  await running?.app.close();
  running = undefined;
}

function invoke(page: Page, channel: 'settings:get' | 'settings:update', payload?: unknown): Promise<Result<Settings>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  ) as Promise<Result<Settings>>;
}

async function getSettings(page: Page): Promise<Settings> {
  const result = await invoke(page, 'settings:get');
  if (!result.ok) throw new Error(`settings:get failed: ${result.message}`);
  return result.data;
}

function settingsFile(): string {
  return join(userDataDir, 'settings.json');
}

function readSettingsFile(): unknown {
  return JSON.parse(readFileSync(settingsFile(), 'utf8'));
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-settings-'));
});

test.afterEach(async () => {
  await close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('collapsed lanes survive a restart', async () => {
  test.slow(); // two launches
  const page = await launch();
  const fresh = await getSettings(page);
  expect(fresh.version).toBe(2);
  expect(fresh.ui.collapsedLanes).toEqual(['done']);

  const updated = await invoke(page, 'settings:update', { ui: { collapsedLanes: ['qa', 'done'] } });
  expect(updated.ok).toBe(true);
  await close();

  // Written by the app into its own data folder, nowhere else.
  expect(readSettingsFile()).toMatchObject({ version: 2, ui: { collapsedLanes: ['qa', 'done'] } });

  const afterRestart = await launch();
  expect((await getSettings(afterRestart)).ui.collapsedLanes).toEqual(['qa', 'done']);
});

test('a version 1 settings file is migrated to version 2 on start-up', async () => {
  const repoPath = join(userDataDir, 'repos', 'onsite-companion');
  writeFileSync(
    settingsFile(),
    JSON.stringify({
      version: 1,
      lastRepo: repoPath,
      collapsedLanes: ['queued', 'done'],
      defaultModel: 'sonnet',
      defaultEffort: 'high',
      gatedStages: ['planning', 'qa'],
    }),
  );

  const page = await launch();
  expect(await getSettings(page)).toMatchObject({
    version: 2,
    repos: [{ path: repoPath, name: 'onsite-companion', baseBranch: 'main', maxConcurrentAgents: 3 }],
    defaults: {
      model: 'sonnet',
      effort: 'high',
      stageGates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'approval', 'create-pr': 'auto' },
    },
    ui: { lastRepo: repoPath, collapsedLanes: ['queued', 'done'] },
  });
  await close();

  expect(readSettingsFile()).toMatchObject({ version: 2, ui: { lastRepo: repoPath } });
});

test('a corrupt settings file falls back to the defaults and is replaced on the next save', async () => {
  writeFileSync(settingsFile(), '{ "version": 2, "ui": ');

  const page = await launch();
  expect((await getSettings(page)).ui.collapsedLanes).toEqual(['done']);

  expect((await invoke(page, 'settings:update', { buildQueueSize: 3 })).ok).toBe(true);
  expect(readSettingsFile()).toMatchObject({ version: 2, buildQueueSize: 3 });
});

test('ADO state transitions start off and are saved when turned on (AL-063)', async () => {
  const page = await launch();
  expect((await getSettings(page)).adoStateTransitions).toBe(false);

  const updated = await invoke(page, 'settings:update', { adoStateTransitions: true });
  expect(updated.ok && updated.data.adoStateTransitions).toBe(true);
  await close();

  expect(readSettingsFile()).toMatchObject({ version: 2, adoStateTransitions: true });
});

test('an invalid update is refused and nothing is written', async () => {
  const page = await launch();
  const refused = await invoke(page, 'settings:update', { ui: { collapsedLanes: ['backlog'] } });
  expect(refused).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(existsSync(settingsFile())).toBe(false);
});
