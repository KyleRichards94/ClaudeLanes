import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { TicketRecord } from '@agent-lanes/contracts';

/**
 * AL-101 ticket records in the real app: the store reads `<userData>/tickets` at start-up; a damaged
 * record or a write cut short by a kill never stops the app, and good records are left byte for byte.
 */

const START = 1_760_000_000_000;

const record: TicketRecord = {
  version: 1,
  id: '71273',
  title: 'Cutover frmJobControl to Blazor',
  ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
  repo: 'C:\\src\\onsite-companion',
  baseBranch: 'main',
  branch: '71273-cutover-frmjobcontrol-to',
  worktreePath: 'C:\\src\\.agent-lanes\\71273',
  subBranches: [],
  stage: 'implementing',
  stageHistory: [
    { stage: 'queued', at: START },
    { stage: 'planning', at: START + 1 },
    { stage: 'implementing', at: START + 2 },
  ],
  gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
  model: 'opus',
  effort: 'xhigh',
  skills: ['code-review'],
  sessionId: 'cc-71273',
  lastBuild: null,
  lastRun: null,
  design: { canvas: null, lastViewUrl: null, specs: [] },
  createdAt: START,
  updatedAt: START + 2,
};

test.describe('ticket records', () => {
  let app: ElectronApplication | undefined;
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-tickets-'));
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('starts with a corrupt record and an unfinished write, sets them aside, and leaves good records untouched', async () => {
    const folder = join(userDataDir, 'tickets', 'onsite-companion-0123456789ab');
    mkdirSync(folder, { recursive: true });
    const good = `${JSON.stringify(record, null, 2)}\n`;
    const corrupt = '{"version":1,"id":"71274","ti';
    writeFileSync(join(folder, '71273.json'), good);
    writeFileSync(join(folder, '71274.json'), corrupt);
    writeFileSync(join(folder, '71273.json.4242-7.tmp'), '{"version":1,"id":"7127');

    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
    });
    const page = await app.firstWindow();
    await expect(page.getByText('Agent board')).toBeVisible();

    await expect.poll(() => readdirSync(folder).sort()).toEqual(['71273.json', expect.stringMatching(/^71274\.corrupt-.+\.json$/)]);
    const moved = readdirSync(folder).find((name) => name.startsWith('71274.corrupt-')) ?? '';
    expect(readFileSync(join(folder, moved), 'utf8')).toBe(corrupt);

    // Quitting flushes unsaved changes only; an untouched record is never rewritten.
    await app.close();
    app = undefined;
    expect(readFileSync(join(folder, '71273.json'), 'utf8')).toBe(good);
  });
});
