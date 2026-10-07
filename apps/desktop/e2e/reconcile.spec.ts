import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Result, Settings, TicketBoard, TicketRecord } from '@agent-lanes/contracts';

/**
 * AL-090 start-up reconciliation in the real app: the board comes back the same after a restart —
 * stage, model/effort and the session id a resumed session needs — checked against real git
 * worktrees; an unknown worktree under the worktree folder is offered for Adopt / Ignore.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const START = 1_760_000_000_000;
let root: string;
let userDataDir: string;
let app: ElectronApplication | undefined;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      GIT_AUTHOR_NAME: 'Agent Lanes Test',
      GIT_AUTHOR_EMAIL: 'test@agent-lanes.invalid',
      GIT_COMMITTER_NAME: 'Agent Lanes Test',
      GIT_COMMITTER_EMAIL: 'test@agent-lanes.invalid',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

async function launch(): Promise<Page> {
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  const page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  return page;
}

/** Quits the running app (flushing its state) and starts it again on the same profile. */
async function restart(): Promise<Page> {
  await app?.close();
  app = undefined;
  return launch();
}

function invoke<T>(page: Page, channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

test.describe('start-up reconciliation', () => {
  test.beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-reconcile-')));
    userDataDir = join(root, 'user-data');
    mkdirSync(userDataDir);
    writeFileSync(join(root, 'gitconfig'), '[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n');
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('restarting shows the same board, with the session id to resume and orphans offered for Adopt', async () => {
    const work = join(root, 'onsite-companion');
    git(['init', '--quiet', '--initial-branch=main', work], root);
    writeFileSync(join(work, 'README.md'), '# fixture\n');
    git(['add', '--all'], work);
    git(['commit', '--quiet', '-m', 'Initial commit'], work);
    const worktreeRoot = join(root, '.agent-lanes');
    const ticketPath = join(worktreeRoot, '71273');
    const orphanPath = join(worktreeRoot, '71300');
    git(['worktree', 'add', '--quiet', '-b', '71273-cutover', ticketPath, 'main'], work);
    git(['worktree', 'add', '--quiet', '-b', '71300-paging', orphanPath, 'main'], work);

    const record: TicketRecord = {
      version: 1,
      id: '71273',
      title: 'Cutover frmJobControl to Blazor',
      ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
      repo: work,
      baseBranch: 'main',
      branch: '71273-cutover',
      worktreePath: ticketPath,
      subBranches: [],
      stage: 'implementing',
      stageHistory: [
        { stage: 'queued', at: START },
        { stage: 'implementing', at: START + 1 },
      ],
      gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
      model: 'sonnet',
      effort: 'high',
      skills: ['code-review'],
      sessionId: 'cc-71273',
      lastBuild: null,
      lastRun: null,
      design: { canvas: null, lastViewUrl: null, specs: [] },
      createdAt: START,
      updatedAt: START + 1,
    };
    const folder = join(userDataDir, 'tickets', 'onsite-companion-0123456789ab');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, '71273.json'), `${JSON.stringify(record, null, 2)}\n`);

    // Repos are only added through the native folder picker, so the test registers it in the settings
    // file the first launch wrote, as AL-081 would have.
    let page = await launch();
    const settings = await invoke<Settings>(page, 'settings:get');
    if (!settings.ok) throw new Error(settings.message);
    await app?.close();
    app = undefined;
    const repoSettings = {
      path: work,
      name: 'onsite-companion',
      baseBranch: 'main',
      worktreeRoot,
      buildCommand: null,
      runCommand: null,
      maxConcurrentAgents: 3,
    };
    writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ ...settings.data, repos: [repoSettings] }, null, 2));
    page = await launch();

    const before = await invoke<TicketBoard>(page, 'tickets:board');
    expect(before).toMatchObject({
      ok: true,
      data: {
        tickets: [{ id: '71273', stage: 'implementing', model: 'sonnet', effort: 'high', sessionId: 'cc-71273' }],
        missingWorktrees: [],
        orphans: [{ worktreePath: orphanPath, branch: '71300-paging', ticketId: '71300' }],
      },
    });

    page = await restart();

    const after = await invoke<TicketBoard>(page, 'tickets:board');
    expect(after).toEqual(before);

    // Adopt the orphan: it becomes a ticket and survives the next restart too.
    expect(await invoke(page, 'tickets:adoptWorktree', { worktreePath: orphanPath })).toMatchObject({
      ok: true,
      data: { adoptedAs: 'ticket', record: { id: '71300', branch: '71300-paging' } },
    });
    page = await restart();
    const adopted = await invoke<TicketBoard>(page, 'tickets:board');
    expect(adopted).toMatchObject({ ok: true, data: { orphans: [], missingWorktrees: [] } });
    expect(adopted.ok && adopted.data.tickets.map((ticket) => ticket.id).sort()).toEqual(['71273', '71300']);
  });
});
