import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

/** Every `71273.json` under the tickets folder, parsed. */
function savedRecords(ticketsDir: string): TicketRecord[] {
  return readdirSync(ticketsDir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('71273.json'))
    .map((path) => JSON.parse(readFileSync(join(ticketsDir, path), 'utf8')) as TicketRecord);
}

let app: ElectronApplication | undefined;
let ticketsDir: string;
let root: string;
let page: Page;

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-agent-'));
  const userDataDir = join(root, 'user-data');
  ticketsDir = join(userDataDir, 'tickets');
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

test('agent:getTranscript backfills an empty transcript for a ticket with no output yet (AL-102)', async () => {
  expect(await invoke(page, 'agent:getTranscript', { ticketId: '71273' })).toEqual({ ok: true, data: { ticketId: '71273', events: [], lastSeq: 0 } });
});

test('stage gates answer over IPC and a gate change is saved on the ticket (AL-104)', async () => {
  expect(await invoke(page, 'agent:getGate', { ticketId: '71273' })).toEqual({ ok: true, data: { gate: null } });
  expect(await invoke(page, 'agent:resolveGate', { ticketId: '71273', decision: 'approve' })).toEqual({ ok: true, data: { resolved: false } });
  expect(await invoke(page, 'agent:resolveGate', { ticketId: '71273', decision: 'request-changes' })).toMatchObject({ ok: false, code: 'VALIDATION' });

  // Gates are per ticket and editable (the drill-in's stepper, AL-171).
  expect(await invoke(page, 'agent:setGate', { ticketId: '71273', stage: 'qa', gate: 'approval' })).toEqual({
    ok: true,
    data: { gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'approval', 'create-pr': 'approval' }, released: false },
  });

  // Quitting writes the change to the ticket record.
  await app?.close();
  app = undefined;
  const records = savedRecords(ticketsDir);
  expect(records.length).toBeGreaterThan(0);
  expect(records.some((record) => record.gates.qa === 'approval')).toBe(true);
});

test('messages, skill chips and pause are refused with a reason when no session runs (AL-105)', async () => {
  expect(await invoke(page, 'agent:send', { ticketId: '71273', text: '/code-review' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke(page, 'agent:send', { ticketId: '71273', text: '   ' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke(page, 'agent:pause', { ticketId: '71273' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke(page, 'agent:resume', { ticketId: '71273' })).toMatchObject({ ok: false, code: 'VALIDATION' });
});

test('model and effort changes answer over IPC and are saved on the ticket record (AL-106)', async () => {
  expect(await invoke(page, 'agent:getModel', { ticketId: '71273' })).toEqual({ ok: true, data: { ticketId: '71273', model: 'opus', effort: 'xhigh', pending: null } });
  // No session runs, so a change applies at once.
  expect(await invoke(page, 'agent:setModel', { ticketId: '71273', model: 'sonnet' })).toEqual({
    ok: true,
    data: { ticketId: '71273', model: 'sonnet', effort: 'xhigh', pending: null },
  });
  expect(await invoke(page, 'agent:setEffort', { ticketId: '71273', effort: 'high' })).toEqual({
    ok: true,
    data: { ticketId: '71273', model: 'sonnet', effort: 'high', pending: null },
  });
  expect(await invoke(page, 'agent:setEffort', { ticketId: '71273', effort: 'extreme' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke(page, 'agent:applyModelNow', { ticketId: '71273' })).toMatchObject({ ok: false, code: 'VALIDATION' });

  await app?.close();
  app = undefined;
  const records = savedRecords(ticketsDir);
  expect(records.some((record) => record.model === 'sonnet' && record.effort === 'high')).toBe(true);
});

test('agent:getUsage reports no tokens for a ticket whose session has not run (AL-113)', async () => {
  expect(await invoke(page, 'agent:getUsage', { ticketId: '71273' })).toEqual({
    ok: true,
    data: {
      ticketId: '71273',
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      leadTokens: 0,
      subagents: [],
      costUsd: 0,
      turns: 0,
      context: null,
      updatedAt: null,
    },
  });
  expect(await invoke(page, 'agent:getUsage', { ticketId: 'NOT A TICKET' })).toMatchObject({ ok: false, code: 'VALIDATION' });
});

test('Stop turn and End session answer over IPC when no session runs (AL-253)', async () => {
  expect(await invoke(page, 'agent:interrupt', { ticketId: '71273' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke(page, 'agent:stop', { ticketId: '71273' })).toMatchObject({ ok: true, data: { stopped: false, status: { ticketId: '71273', state: 'none' } } });
  expect(await invoke(page, 'agent:stop', { ticketId: 'NOT A TICKET' })).toMatchObject({ ok: false, code: 'VALIDATION' });
});
