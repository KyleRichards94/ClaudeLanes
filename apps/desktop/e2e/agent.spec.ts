import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Result, TicketRecord } from '@agent-lanes/contracts';

/**
 * The `agent:*` channels (AL-100–AL-105) in the real app: the renderer reaches the session manager,
 * transcript buffer and stage gates through the preload. No session is started here (that needs
 * Launch, AL-165); sessions, output and gates run against the Agent SDK and its stand-in CLI in the
 * main-process tests.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const START = 1_760_000_000_000;

function ticket(base: string): TicketRecord {
  return {
    version: 1,
    id: '71273',
    title: 'Cutover frmJobControl to Blazor',
    ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
    repo: join(base, 'onsite-companion'),
    baseBranch: 'main',
    branch: '71273-cutover-frmjobcontrol-to',
    worktreePath: join(base, '.agent-lanes', '71273'),
    subBranches: [],
    stage: 'planning',
    stageHistory: [
      { stage: 'queued', at: START },
      { stage: 'planning', at: START + 1 },
    ],
    gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    model: 'opus',
    effort: 'xhigh',
    skills: ['code-review'],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: START,
    updatedAt: START + 1,
  };
}

function invoke<T>(page: Page, channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

let app: ElectronApplication | undefined;
let root: string;
let page: Page;

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-agent-'));
  const userDataDir = join(root, 'user-data');
  const ticketsDir = join(userDataDir, 'tickets');
  const folder = join(ticketsDir, 'onsite-companion-0123456789ab');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, '71273.json'), `${JSON.stringify(ticket(root), null, 2)}\n`);

  app = await electron.launch({
    args: [join(__dirname, '..')],
    // CLAUDE_CONFIG_DIR keeps any Claude Code lookup away from this machine's real ~/.claude.
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

test('agent:getStatus reports a ticket without a session and refuses a bad ticket id (AL-100)', async () => {
  expect(await invoke(page, 'agent:getStatus', { ticketId: '71273' })).toEqual({
    ok: true,
    data: { ticketId: '71273', state: 'none', sessionId: null, message: null },
  });
  expect(await invoke(page, 'agent:getStatus', { ticketId: '../../etc' })).toMatchObject({ ok: false, code: 'VALIDATION' });
});
